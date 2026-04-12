import { describe, it, expect, beforeEach } from "vitest";
import { ingestParsedEpisodes } from "./ingest";
import { parseHtmlDocument } from "../services/html-parser";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import sampleHtml from "../../test/fixtures/sample-mobilebasic.html?raw";

const parsedEpisodes = parseHtmlDocument(sampleHtml);

beforeEach(async () => {
  await applyTestMigrations(env.DB);

  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES (?, ?)"
  )
    .bind("test-doc-id", "Test Source")
    .run();
});

describe("ingestParsedEpisodes", () => {
  it("inserts episodes and chunks into D1", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    const result = await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    expect(result.episodesAdded).toBe(3);
    expect(result.chunksAdded).toBeGreaterThan(0);

    const episodes = await env.DB.prepare(
      "SELECT * FROM episodes ORDER BY published_date DESC"
    ).all();
    expect(episodes.results).toHaveLength(3);
    expect((episodes.results[0] as any).slug).toContain("2026-04-06");
    expect((episodes.results[1] as any).slug).toContain("2026-03-30");
    expect((episodes.results[2] as any).slug).toContain("2026-03-23");
  });

  it("inserts chunks with correct content", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    const chunks = await env.DB.prepare("SELECT * FROM chunks ORDER BY id").all();
    expect(chunks.results.length).toBeGreaterThan(0);
    // First chunk is from the first chunk in the first episode
    expect((chunks.results[0] as any).content).toContain("software");
  });

  it("generates topics for chunks", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    const topics = await env.DB.prepare("SELECT * FROM topics").all();
    expect(topics.results.length).toBeGreaterThan(0);
  });

  it("is idempotent — re-ingesting same episodes adds no duplicates", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };

    const first = await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);
    expect(first.episodesAdded).toBe(3);

    const second = await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);
    expect(second.episodesAdded).toBe(0);
    expect(second.chunksAdded).toBe(0);
  });

  it("updates word_stats after ingestion", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    const wordStats = await env.DB.prepare(
      "SELECT * FROM word_stats ORDER BY total_count DESC LIMIT 5"
    ).all();
    expect(wordStats.results.length).toBeGreaterThan(0);
  });
});
