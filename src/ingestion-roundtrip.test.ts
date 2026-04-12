/**
 * Integration test: parse fixture HTML → ingest into D1 → verify DB matches parser output exactly.
 * Uses real D1 binding via Workers vitest pool. No mocks.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../test/helpers/migrations";
import { parseHtmlDocument } from "./services/html-parser";
import { ingestParsedEpisodes } from "./jobs/ingest";
import sampleEssays from "../test/fixtures/sample-mobilebasic.html?raw";
import sampleNotes from "../test/fixtures/sample-notes-format.html?raw";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"
  ).run();
});

describe("Ingestion roundtrip: essays fixture", () => {
  it("every parsed episode ends up in D1 with correct fields", async () => {
    const parsed = parseHtmlDocument(sampleEssays);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    const result = await ingestParsedEpisodes(testEnv, 1, parsed);

    expect(result.episodesAdded).toBe(parsed.length);

    const dbEpisodes = await env.DB.prepare(
      "SELECT * FROM episodes ORDER BY published_date DESC"
    ).all();

    expect(dbEpisodes.results).toHaveLength(parsed.length);

    for (let i = 0; i < parsed.length; i++) {
      const pe = parsed[i];
      const de = dbEpisodes.results[i] as any;
      expect(de.title).toBe(pe.title);
      expect(de.format).toBe(pe.format);
      expect(de.chunk_count).toBe(pe.chunks.length);
      expect(de.year).toBe(pe.parsedDate.getUTCFullYear());
      expect(de.month).toBe(pe.parsedDate.getUTCMonth() + 1);
      expect(de.day).toBe(pe.parsedDate.getUTCDate());
    }
  });

  it("every parsed chunk ends up in D1 with correct fields", async () => {
    const parsed = parseHtmlDocument(sampleEssays);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsed);

    const totalParsedChunks = parsed.reduce((s, ep) => s + ep.chunks.length, 0);
    const dbChunks = await env.DB.prepare("SELECT * FROM chunks ORDER BY id").all();
    expect(dbChunks.results).toHaveLength(totalParsedChunks);

    // Verify each chunk matches
    let dbIdx = 0;
    for (const ep of parsed) {
      for (const pc of ep.chunks) {
        const dc = dbChunks.results[dbIdx] as any;
        expect(dc.title).toBe(pc.title);
        expect(dc.position).toBe(pc.position);
        expect(dc.content_plain).toBe(pc.contentPlain);
        expect(dc.content_plain.length).toBeGreaterThan(0);
        dbIdx++;
      }
    }
  });

  it("format is stored correctly as essays", async () => {
    const parsed = parseHtmlDocument(sampleEssays);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsed);

    const episodes = await env.DB.prepare("SELECT format FROM episodes").all();
    for (const ep of episodes.results as any[]) {
      expect(ep.format).toBe("essays");
    }
  });
});

describe("Ingestion roundtrip: notes fixture", () => {
  it("notes format is stored correctly", async () => {
    const parsed = parseHtmlDocument(sampleNotes);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsed);

    const episodes = await env.DB.prepare("SELECT format, chunk_count FROM episodes").all();
    expect(episodes.results).toHaveLength(1);
    expect((episodes.results[0] as any).format).toBe("notes");
    expect((episodes.results[0] as any).chunk_count).toBe(parsed[0].chunks.length);
  });

  it("all chunks have sequential positions", async () => {
    const parsed = parseHtmlDocument(sampleNotes);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsed);

    const chunks = await env.DB.prepare(
      "SELECT position FROM chunks ORDER BY position"
    ).all();
    for (let i = 0; i < chunks.results.length; i++) {
      expect((chunks.results[i] as any).position).toBe(i);
    }
  });
});

describe("Ingestion roundtrip: no data loss", () => {
  it("ingesting both fixtures produces no duplicate slugs", async () => {
    const essays = parseHtmlDocument(sampleEssays);
    const notes = parseHtmlDocument(sampleNotes);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };

    await ingestParsedEpisodes(testEnv, 1, essays);
    await ingestParsedEpisodes(testEnv, 1, notes);

    const dupEpisodes = await env.DB.prepare(
      "SELECT slug, COUNT(*) as c FROM episodes GROUP BY slug HAVING c > 1"
    ).all();
    expect(dupEpisodes.results).toHaveLength(0);

    const dupChunks = await env.DB.prepare(
      "SELECT slug, COUNT(*) as c FROM chunks GROUP BY slug HAVING c > 1"
    ).all();
    expect(dupChunks.results).toHaveLength(0);
  });

  it("topic counts are positive for all generated topics", async () => {
    const parsed = parseHtmlDocument(sampleEssays);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsed);

    const topics = await env.DB.prepare("SELECT * FROM topics").all();
    for (const topic of topics.results as any[]) {
      expect(topic.usage_count).toBeGreaterThan(0);
      expect(topic.name.length).toBeGreaterThan(0);
      expect(topic.slug.length).toBeGreaterThan(0);
    }
  });

  it("word_stats is populated after ingestion", async () => {
    const parsed = parseHtmlDocument(sampleEssays);
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsed);

    const wordStats = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM word_stats"
    ).first();
    expect((wordStats as any).c).toBeGreaterThan(0);
  });
});
