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
  it("registers and ingests a trusted Komoroske archive doc id", async () => {
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
    expect(data.totalInDoc).toBe(1);

    const source = await env.DB.prepare(
      "SELECT title, is_archive FROM sources WHERE google_doc_id = ?"
    ).bind(docId).first<{ title: string; is_archive: number }>();
    expect(source).toEqual({ title: "Archive (2023-2024)", is_archive: 1 });
  }, 20_000);

  it("rejects arbitrary doc ids that are not in the trusted registry", async () => {
    const docId = "1aaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbb";

    const res = await SELF.fetch(`http://localhost/api/ingest?doc=${docId}&limit=1`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    const data = await res.json() as {
      error: string;
    };

    expect(res.status).toBe(404);
    expect(data.error).toBe("Unknown or untrusted source" );

    const source = await env.DB.prepare(
      "SELECT title, is_archive FROM sources WHERE google_doc_id = ?"
    ).bind(docId).first<{ title: string; is_archive: number }>();
    expect(source).toBeNull();
  }, 20_000);

  it("purges an already-ingested untrusted source by doc id", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (id, google_doc_id, title, is_archive, active) VALUES (9, '1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0', 'Archive (Essays)', 1, 1)"),
      env.DB.prepare("INSERT INTO episodes (id, source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (5, 9, '2026-02-23-1IPwKw', 'Bits and Bobs 2/23/26', '2026-02-23', 2026, 2, 23, 2, 'essays')"),
      env.DB.prepare("INSERT INTO chunks (id, episode_id, slug, title, content, content_plain, position) VALUES (11, 5, 'model-scaffolding-context-2026-02-23-1IPwKw-0', 'Model × Scaffolding × Context', 'Model × Scaffolding × Context', 'Model × Scaffolding × Context', 0)"),
      env.DB.prepare("INSERT INTO chunks (id, episode_id, slug, title, content, content_plain, position) VALUES (12, 5, 'cognitive-debt-is-the-rate-limiting-step-2026-02-23-1IPwKw-1', 'Cognitive debt is the rate-limiting step', 'Cognitive debt is the rate-limiting step', 'Cognitive debt is the rate-limiting step', 1)"),
      env.DB.prepare("INSERT INTO source_html_chunks (source_id, chunk_index, fetched_at, html_chunk) VALUES (9, 0, '2026-05-01T00:00:00.000Z', '<html></html>')"),
      env.DB.prepare("INSERT INTO ingestion_log (id, source_id, status, run_type) VALUES (21, 9, 'completed', 'refresh')"),
      env.DB.prepare("INSERT INTO pipeline_runs (id, ingestion_log_id, source_id, run_type, extractor_mode, status) VALUES (31, 21, 9, 'refresh', 'naive', 'completed')"),
    ]);

    const res = await SELF.fetch("http://localhost/api/purge-source?doc=1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0", {
      headers: { Authorization: "Bearer test-secret" },
    });
    const data = await res.json() as {
      status: string;
      docId: string;
      episodesDeleted: number;
      chunksDeleted: number;
      sourceDeleted: boolean;
    };

    expect(res.status).toBe(200);
    expect(data).toEqual({
      status: "ok",
      docId: "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0",
      episodesDeleted: 1,
      chunksDeleted: 2,
      sourceDeleted: true,
    });

    const counts = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) as c FROM sources WHERE id = 9"),
      env.DB.prepare("SELECT COUNT(*) as c FROM episodes WHERE source_id = 9"),
      env.DB.prepare("SELECT COUNT(*) as c FROM chunks WHERE episode_id = 5"),
      env.DB.prepare("SELECT COUNT(*) as c FROM source_html_chunks WHERE source_id = 9"),
      env.DB.prepare("SELECT COUNT(*) as c FROM ingestion_log WHERE source_id = 9"),
      env.DB.prepare("SELECT COUNT(*) as c FROM pipeline_runs WHERE source_id = 9"),
    ]);

    expect(counts.map((result: any) => result.results[0].c)).toEqual([0, 0, 0, 0, 0, 0]);
  }, 20_000);
});
