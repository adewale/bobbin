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
    expect(logs.results.length).toBe(3);
    expect(logs.results.every((log) => log.run_type === "refresh")).toBe(true);
    expect(logs.results.every((log) => log.pipeline_report !== null)).toBe(true);
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
});
