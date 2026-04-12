import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-01-15', 'Ep 1', '2024-01-15', 2024, 1, 15, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-03-18', 'Ep 2', '2024-03-18', 2024, 3, 18, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1', 'Chunk 1', 'Ecosystems grow.', 'Ecosystems grow.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'c2', 'Chunk 2', 'Platforms evolve.', 'Platforms evolve.', 0)"),
    env.DB.prepare("INSERT INTO word_stats (word, total_count, doc_count) VALUES ('ecosystem', 3, 2)"),
    env.DB.prepare("INSERT INTO word_stats (word, total_count, doc_count) VALUES ('platform', 2, 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 2)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'platform', 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'ecosystem', 1)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedData();
});

describe("GET /api/word-stats", () => {
  it("returns word frequencies as JSON", async () => {
    const res = await SELF.fetch("http://localhost/api/word-stats");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.words.length).toBeGreaterThan(0);
    expect(data.words[0]).toHaveProperty("word");
    expect(data.words[0]).toHaveProperty("total_count");
  });

  it("filters by date range", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/word-stats?from=2024-03-01&to=2024-04-01"
    );
    const data = (await res.json()) as any;
    // Only chunk 2 is in this range, which has "platform" and "ecosystem"
    const words = data.words.map((w: any) => w.word);
    expect(words).toContain("platform");
  });
});

describe("GET /word-stats (interactive)", () => {
  it("includes the reactive JS bundle", async () => {
    const res = await SELF.fetch("http://localhost/word-stats");
    const html = await res.text();
    expect(html).toContain("reactive.js");
  });
});
