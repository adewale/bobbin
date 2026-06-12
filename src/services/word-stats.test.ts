import { describe, it, expect, beforeEach } from "vitest";
import { rebuildWordStatsAggregates } from "./word-stats";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("rebuildWordStatsAggregates", () => {
  it("aggregates per-chunk word counts into word_stats totals", async () => {
    // Set up test data: source + episode + 2 chunks with chunk_words rows
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test-doc', 'Test')"),
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day) VALUES (1, '2024-01-01', 'Test Episode', '2024-01-01', 2024, 1, 1)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1', 'Chunk 1', 'content', 'ecosystem platform ecosystem', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-2', 'Chunk 2', 'content', 'ecosystem dynamics complex', 1)"),
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 2)"),
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'platform', 1)"),
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'ecosystem', 1)"),
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'dynamics', 1)"),
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'complex', 1)"),
    ]);

    await rebuildWordStatsAggregates(env.DB);

    const ecosystem = await env.DB.prepare(
      "SELECT * FROM word_stats WHERE word = ?"
    ).bind("ecosystem").first();

    expect(ecosystem).not.toBeNull();
    expect(ecosystem!.total_count).toBe(3); // 2 in chunk1 + 1 in chunk2
    expect(ecosystem!.doc_count).toBe(2); // appears in both chunks

    const platform = await env.DB.prepare(
      "SELECT * FROM word_stats WHERE word = ?"
    ).bind("platform").first();
    expect(platform!.total_count).toBe(1);
    expect(platform!.doc_count).toBe(1);
  });
});
