import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import sampleNotesHtml from "../../test/fixtures/sample-notes-format.html?raw";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  (env as any).ADMIN_SECRET = "test-secret";
  (env as any).__TEST_FETCH_GOOGLE_DOC = async () => ({
    html: sampleNotesHtml,
    fetchedAt: new Date().toISOString(),
  });
  (env as any).__TEST_ENRICH_EPISODES_WITH_LLM = async () => undefined;
});

describe("/api/ingest source registration", () => {
  it("auto-registers an unknown doc id and ingests it", async () => {
    const docId = "1BZCiakRHDd2I337FmJv8RGcrcycapXPXN_wHPO5-DaA";

    const before = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM sources WHERE google_doc_id = ?"
    ).bind(docId).first<{ c: number }>();
    expect(before?.c).toBe(0);

    const res = await SELF.fetch(`http://localhost/api/ingest?doc=${docId}&limit=1`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    const data = await res.json() as {
      status: string;
      source: string;
      episodesIngested: number;
      chunksIngested: number;
      totalInDoc: number;
    };

    expect(res.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.source).toBe("Archive (2023-2024)");
    expect(data.episodesIngested).toBe(1);
    expect(data.chunksIngested).toBeGreaterThan(0);
    expect(data.totalInDoc).toBe(57);

    const source = await env.DB.prepare(
      "SELECT title, is_archive FROM sources WHERE google_doc_id = ?"
    ).bind(docId).first<{ title: string; is_archive: number }>();
    expect(source).toEqual({ title: "Archive (2023-2024)", is_archive: 1 });
  }, 20_000);
});
