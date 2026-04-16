import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { runRefresh } from "./refresh";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("runRefresh", () => {
  it("seeds the current doc source if sources table is empty", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) as c FROM sources").first();
    expect((before as any).c).toBe(0);

    // runRefresh makes a real HTTP call that may fail/timeout in tests
    await runRefresh({ ...env, ADMIN_SECRET: "" } as any).catch(() => {});

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

    // runRefresh makes a real HTTP call that may fail/timeout in tests
    await runRefresh({ ...env, ADMIN_SECRET: "" } as any).catch(() => {});

    const logs = await env.DB.prepare("SELECT run_type, pipeline_report FROM ingestion_log").all<{
      run_type: string;
      pipeline_report: string | null;
    }>();
    expect(logs.results.length).toBe(1);
    expect(logs.results[0].run_type).toBe("refresh");
    expect(logs.results[0].pipeline_report).not.toBeNull();
  }, 20000);
});
