import { describe, it, expect, beforeEach } from "vitest";
import { tokenizeForWordStats, updateWordStats, rebuildWordStatsAggregates } from "./word-stats";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("tokenizeForWordStats", () => {
  it("returns word frequency map excluding stopwords", () => {
    const result = tokenizeForWordStats("The quick brown foxes jump over the quick brown dogs repeatedly");
    expect(result.get("quick")).toBe(2);
    expect(result.get("brown")).toBe(2);
    expect(result.get("foxes")).toBe(1);
    expect(result.has("the")).toBe(false);
    expect(result.has("over")).toBe(false);
  });

  it("excludes words <= 2 chars", () => {
    const result = tokenizeForWordStats("I am a big AI fan");
    expect(result.has("i")).toBe(false);
    expect(result.has("am")).toBe(false);
    expect(result.has("a")).toBe(false);
  });
});

describe("updateWordStats + rebuildAggregates", () => {
  it("stores word counts and aggregates across chunks", async () => {
    // Set up test data: source + episode + 2 chunks
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test-doc', 'Test')"),
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day) VALUES (1, '2024-01-01', 'Test Episode', '2024-01-01', 2024, 1, 1)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1', 'Chunk 1', 'content', 'ecosystem platform ecosystem', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-2', 'Chunk 2', 'content', 'ecosystem dynamics complex', 1)"),
    ]);

    await updateWordStats(env.DB, 1, "ecosystem platform ecosystem");
    await updateWordStats(env.DB, 2, "ecosystem dynamics complex");
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
