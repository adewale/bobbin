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
    expect(after.results.length).toBe(1);
    expect((after.results[0] as any).title).toContain("Current");
    expect((after.results[0] as any).google_doc_id).toBe(
      "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA"
    );
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
    expect(logs.results.length).toBe(1);
    expect(logs.results[0].run_type).toBe("refresh");
    expect(logs.results[0].pipeline_report).not.toBeNull();
  }, 20000);
});
