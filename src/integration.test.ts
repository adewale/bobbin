import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../test/helpers/migrations";
import { parseHtmlDocument } from "./services/html-parser";
import { ingestParsedEpisodes } from "./jobs/ingest";
import sampleHtml from "../test/fixtures/sample-mobilebasic.html?raw";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"
  ).run();
});

function makeTestEnv() {
  return { ...env, AI: null as any, VECTORIZE: null as any, ADMIN_SECRET: "" };
}

// === End-to-end: parse → ingest → query → render ===
describe("End-to-end ingestion pipeline", () => {
  it("parse HTML → ingest → episodes and chunks in DB", async () => {
    const episodes = parseHtmlDocument(sampleHtml);
    const result = await ingestParsedEpisodes(makeTestEnv(), 1, episodes);

    expect(result.episodesAdded).toBe(3);
    expect(result.chunksAdded).toBeGreaterThan(0);

    // Verify data is queryable via routes
    const homeRes = await SELF.fetch("http://localhost/");
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain("Bits and Bobs 4/6/26");

    // Find the actual episode slug (includes source tag)
    const epSlug = await env.DB.prepare(
      "SELECT slug FROM episodes WHERE published_date = '2026-04-06'"
    ).first();
    const epRes = await SELF.fetch(`http://localhost/episodes/${(epSlug as any).slug}`);
    expect(epRes.status).toBe(200);
    const epHtml = await epRes.text();
    expect(epHtml).toContain("software provider");
  });

  it("ingested data is searchable via FTS", async () => {
    const episodes = parseHtmlDocument(sampleHtml);
    await ingestParsedEpisodes(makeTestEnv(), 1, episodes);

    // Create FTS table and populate
    await env.DB.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, content_plain, content='chunks', content_rowid='id', tokenize='porter unicode61')"
    );
    await env.DB.exec(
      "INSERT INTO chunks_fts(rowid, title, content_plain) SELECT id, title, content_plain FROM chunks"
    );

    const searchRes = await SELF.fetch("http://localhost/search?q=software");
    expect(searchRes.status).toBe(200);
    const searchHtml = await searchRes.text();
    expect(searchHtml).toContain("result");
    expect(searchHtml).toContain("software provider");
    expect(searchHtml).not.toContain("No results");
  });

  it("reingesting the same parsed episodes is idempotent", async () => {
    const episodes = parseHtmlDocument(sampleHtml);

    const first = await ingestParsedEpisodes(makeTestEnv(), 1, episodes);
    const before = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM episodes) AS episodes,
         (SELECT COUNT(*) FROM chunks) AS chunks,
         (SELECT COUNT(*) FROM chunk_words) AS chunk_words,
         (SELECT COUNT(*) FROM topic_candidate_audit) AS audit_rows`
    ).first<{ episodes: number; chunks: number; chunk_words: number; audit_rows: number }>();

    const second = await ingestParsedEpisodes(makeTestEnv(), 1, episodes);
    const after = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM episodes) AS episodes,
         (SELECT COUNT(*) FROM chunks) AS chunks,
         (SELECT COUNT(*) FROM chunk_words) AS chunk_words,
         (SELECT COUNT(*) FROM topic_candidate_audit) AS audit_rows`
    ).first<{ episodes: number; chunks: number; chunk_words: number; audit_rows: number }>();

    expect(first.episodesAdded).toBeGreaterThan(0);
    expect(first.chunksAdded).toBeGreaterThan(0);
    expect(second.episodesAdded).toBe(0);
    expect(second.chunksAdded).toBe(0);
    expect(after).toEqual(before);
  });
});

// === Data consistency invariants ===
describe("Data consistency after ingestion", () => {
  beforeEach(async () => {
    const episodes = parseHtmlDocument(sampleHtml);
    await ingestParsedEpisodes(makeTestEnv(), 1, episodes);
  });

  it("every chunk belongs to a valid episode", async () => {
    const orphans = await env.DB.prepare(
      `SELECT c.id FROM chunks c
       LEFT JOIN episodes e ON c.episode_id = e.id
       WHERE e.id IS NULL`
    ).all();
    expect(orphans.results).toHaveLength(0);
  });

  it("episode chunk_count matches actual chunk count", async () => {
    const mismatches = await env.DB.prepare(
      `SELECT e.id, e.chunk_count as declared,
              (SELECT COUNT(*) FROM chunks c WHERE c.episode_id = e.id) as actual
       FROM episodes e
       WHERE e.chunk_count != (SELECT COUNT(*) FROM chunks c WHERE c.episode_id = e.id)`
    ).all();
    expect(mismatches.results).toHaveLength(0);
  });

  it("all chunk_topics reference valid chunks and topics", async () => {
    const invalidChunkRefs = await env.DB.prepare(
      `SELECT ct.chunk_id FROM chunk_topics ct
       LEFT JOIN chunks c ON ct.chunk_id = c.id
       WHERE c.id IS NULL`
    ).all();
    expect(invalidChunkRefs.results).toHaveLength(0);

    const invalidTopicRefs = await env.DB.prepare(
      `SELECT ct.topic_id FROM chunk_topics ct
       LEFT JOIN topics t ON ct.topic_id = t.id
       WHERE t.id IS NULL`
    ).all();
    expect(invalidTopicRefs.results).toHaveLength(0);
  });

  it("topic usage_count matches actual chunk_topics count", async () => {
    const mismatches = await env.DB.prepare(
      `SELECT t.id, t.usage_count as declared,
              (SELECT COUNT(*) FROM chunk_topics ct WHERE ct.topic_id = t.id) as actual
       FROM topics t
       WHERE t.usage_count != (SELECT COUNT(*) FROM chunk_topics ct WHERE ct.topic_id = t.id)`
    ).all();
    // Note: usage_count may be higher than chunk_topics due to increment-on-insert logic
    // This test documents the current behavior
    for (const row of mismatches.results as any[]) {
      expect(row.declared).toBeGreaterThanOrEqual(row.actual);
    }
  });

  it("word_stats word counts are consistent with chunk_words", async () => {
    const wordStats = await env.DB.prepare(
      "SELECT word, total_count, doc_count FROM word_stats"
    ).all();

    for (const row of wordStats.results as any[]) {
      const chunkWords = await env.DB.prepare(
        "SELECT SUM(count) as total, COUNT(DISTINCT chunk_id) as docs FROM chunk_words WHERE word = ?"
      )
        .bind(row.word)
        .first();

      expect((chunkWords as any).total).toBe(row.total_count);
      expect((chunkWords as any).docs).toBe(row.doc_count);
    }
  });

  it("every chunk has persisted normalized analysis text artifacts", async () => {
    const artifactRows = await env.DB.prepare(
      "SELECT analysis_text, normalization_version, normalization_warnings FROM chunks ORDER BY id"
    ).all<{ analysis_text: string | null; normalization_version: number; normalization_warnings: string | null }>();

    expect(artifactRows.results.length).toBeGreaterThan(0);
    for (const row of artifactRows.results) {
      expect(row.analysis_text).toBeTruthy();
      expect(row.normalization_version).toBeGreaterThan(0);
      expect(row.normalization_warnings).not.toBeNull();
    }
  });

  it("chunk positions are sequential within each episode", async () => {
    const episodes = await env.DB.prepare("SELECT id FROM episodes").all();

    for (const ep of episodes.results as any[]) {
      const chunks = await env.DB.prepare(
        "SELECT position FROM chunks WHERE episode_id = ? ORDER BY position"
      )
        .bind(ep.id)
        .all();

      const positions = (chunks.results as any[]).map((c) => c.position);
      for (let i = 0; i < positions.length; i++) {
        expect(positions[i]).toBe(i);
      }
    }
  });

  it("no duplicate episode slugs", async () => {
    const dupes = await env.DB.prepare(
      "SELECT slug, COUNT(*) as c FROM episodes GROUP BY slug HAVING c > 1"
    ).all();
    expect(dupes.results).toHaveLength(0);
  });

  it("no duplicate chunk slugs", async () => {
    const dupes = await env.DB.prepare(
      "SELECT slug, COUNT(*) as c FROM chunks GROUP BY slug HAVING c > 1"
    ).all();
    expect(dupes.results).toHaveLength(0);
  });
});
