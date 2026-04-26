import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { runRefresh } from "./refresh";
import sampleNotesHtml from "../../test/fixtures/sample-notes-format.html?raw";

function makeRefreshTestEnv() {
  return {
    ...env,
    ADMIN_SECRET: "",
    __TEST_FETCH_GOOGLE_DOC: async () => ({
      html: sampleNotesHtml,
      fetchedAt: new Date().toISOString(),
    }),
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
    expect(after.results.length).toBeGreaterThanOrEqual(4);
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
    expect(logs.results.length).toBeGreaterThanOrEqual(4);
    expect(logs.results.every((log) => log.run_type === "refresh")).toBe(true);
    expect(logs.results.every((log) => log.pipeline_report !== null)).toBe(true);
  }, 20000);
});
