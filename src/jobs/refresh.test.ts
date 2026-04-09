import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { runRefresh } from "./refresh";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("runRefresh", () => {
  it("seeds initial sources when sources table is empty", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) as c FROM sources").first();
    expect((before as any).c).toBe(0);

    // Run refresh — it will seed sources then try to fetch (which will fail/timeout)
    // We use a short timeout to avoid hanging
    const promise = runRefresh({ ...env, ADMIN_SECRET: "" } as any);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 3000)
    );

    try {
      await Promise.race([promise, timeout]);
    } catch {
      // Expected: fetch will fail or timeout in test environment
    }

    const after = await env.DB.prepare("SELECT * FROM sources ORDER BY id").all();
    expect(after.results.length).toBe(3);
    expect((after.results[0] as any).title).toContain("Current");
    expect((after.results[1] as any).is_archive).toBe(1);
    expect((after.results[2] as any).is_archive).toBe(1);
  }, 10000);

  it("creates an ingestion_log entry when running", async () => {
    await env.DB.prepare(
      "INSERT INTO sources (google_doc_id, title) VALUES ('fake-id', 'Test')"
    ).run();

    try {
      await runRefresh({ ...env, ADMIN_SECRET: "" } as any);
    } catch {
      // Expected: fetch will fail
    }

    const logs = await env.DB.prepare("SELECT * FROM ingestion_log").all();
    expect(logs.results.length).toBe(1);
    expect((logs.results[0] as any).status).toBe("failed");
    expect((logs.results[0] as any).error_message).toBeTruthy();
  });
});
