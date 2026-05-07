import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { runRefresh } from "./refresh";
import sampleNotesHtml from "../../test/fixtures/sample-notes-format.html?raw";

function makeRefreshTestEnv(fetchImpl?: (docId: string) => Promise<{ html: string; fetchedAt: string }>) {
  return {
    ...env,
    ADMIN_SECRET: "",
    __TEST_FETCH_GOOGLE_DOC: fetchImpl || (async () => ({
      html: sampleNotesHtml,
      fetchedAt: new Date().toISOString(),
    })),
    __TEST_ENRICH_EPISODES_WITH_LLM: async () => undefined,
  } as any;
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("runRefresh", () => {
  it("seeds the current doc source if sources table is empty", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) as c FROM sources").first();
    expect((before as any).c).toBe(0);

    await runRefresh(makeRefreshTestEnv()).catch(() => {});

    const after = await env.DB.prepare("SELECT * FROM sources ORDER BY id").all();
    expect(after.results.length).toBe(3);
    expect((after.results as any[]).some((row) => row.title.includes("Current"))).toBe(true);
    expect((after.results as any[]).some((row) => row.google_doc_id === "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA")).toBe(true);
  }, 20000);

  it("creates an ingestion_log entry for the current source", async () => {
    await env.DB.prepare(
      "INSERT INTO sources (google_doc_id, title) VALUES ('1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA', 'Current')"
    ).run();

    await runRefresh(makeRefreshTestEnv()).catch(() => {});

    const logs = await env.DB.prepare("SELECT run_type, pipeline_report FROM ingestion_log").all<{
      run_type: string;
      pipeline_report: string | null;
    }>();
    expect(logs.results.length).toBe(4);
    expect(logs.results.filter((log) => log.run_type === "refresh")).toHaveLength(3);
    expect(logs.results.filter((log) => log.run_type === "refresh_cycle")).toHaveLength(1);
    expect(logs.results.every((log) => log.pipeline_report !== null)).toBe(true);
  }, 20000);

  it("creates a top-level refresh_cycle log that summarizes source runs", async () => {
    const event = await runRefresh(makeRefreshTestEnv());
    expect(event.status).toBe("completed");

    const cycleLog = await env.DB.prepare(
      "SELECT source_id, run_type, status, episodes_added, chunks_added, pipeline_report FROM ingestion_log WHERE run_type = 'refresh_cycle' ORDER BY id DESC LIMIT 1"
    ).first<{ source_id: number | null; run_type: string; status: string; episodes_added: number; chunks_added: number; pipeline_report: string | null }>();

    expect(cycleLog?.source_id).toBeNull();
    expect(cycleLog?.run_type).toBe("refresh_cycle");
    expect(cycleLog?.status).toBe("completed");
    expect(cycleLog?.pipeline_report).toContain('"sources_processed":3');
  }, 20000);

  it("does not refresh the non-Komoroske field-notes doc", async () => {
    const fetchedDocIds: string[] = [];

    await runRefresh(makeRefreshTestEnv(async (docId: string) => {
      fetchedDocIds.push(docId);
      return {
        html: sampleNotesHtml,
        fetchedAt: new Date().toISOString(),
      };
    }));

    expect(fetchedDocIds).not.toContain("1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0");
    expect(new Set(fetchedDocIds)).toEqual(new Set([
      "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA",
      "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw",
      "1BZCiakRHDd2I337FmJv8RGcrcycapXPXN_wHPO5-DaA",
    ]));
  }, 20000);

  it("marks stale running refresh logs as failed before retrying the same source", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (id, google_doc_id, title, is_archive, active) VALUES (10, '1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw', 'Archive (Notes)', 1, 1)"),
      env.DB.prepare("INSERT INTO ingestion_log (id, source_id, status, run_type) VALUES (55, 10, 'running', 'refresh')"),
      env.DB.prepare("INSERT INTO ingestion_log (id, source_id, status, run_type) VALUES (56, NULL, 'running', 'refresh_cycle')"),
    ]);

    await runRefresh(makeRefreshTestEnv());

    const recovered = await env.DB.prepare(
      "SELECT id, status, error_message FROM ingestion_log WHERE id IN (55, 56) ORDER BY id ASC"
    ).all<{ id: number; status: string; error_message: string | null }>();

    expect(recovered.results).toEqual([
      {
        id: 55,
        status: "failed",
        error_message: "Marked failed by a newer refresh after the previous run stopped before cleanup",
      },
      {
        id: 56,
        status: "failed",
        error_message: "Marked failed by a newer refresh after the previous run stopped before cleanup",
      },
    ]);
  }, 20000);

  it("stops before starting another source when the refresh soft budget is exhausted", async () => {
    const event = await runRefresh({
      ...makeRefreshTestEnv(),
      __TEST_REFRESH_SOFT_BUDGET_MS: 1,
    } as any);

    expect(event.status).toBe("partial");
    expect(event.sources_processed).toBe(1);
    expect(event.sources_skipped).toBe(2);
    expect(event.failed_step).toBe("budget_guard");

    const logs = await env.DB.prepare(
      "SELECT run_type, status FROM ingestion_log ORDER BY id ASC"
    ).all<{ run_type: string; status: string }>();

    expect(logs.results.filter((log) => log.run_type === "refresh")).toHaveLength(1);
    expect(logs.results.filter((log) => log.run_type === "refresh_cycle" && log.status === "partial")).toHaveLength(1);
  }, 20000);
});
