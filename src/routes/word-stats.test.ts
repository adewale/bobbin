import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedTestData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Bits and Bobs 4/8/24', '2024-04-08', 2024, 4, 8, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-03-25', 'Bits and Bobs 3/25/24', '2024-03-25', 2024, 3, 25, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1-2024-04-08', 'Chunk 1', 'content', 'ecosystem platform dynamics', 0)"),
    env.DB.prepare("INSERT INTO word_stats (word, total_count, doc_count) VALUES ('ecosystem', 5, 2)"),
    env.DB.prepare("INSERT INTO word_stats (word, total_count, doc_count) VALUES ('platform', 3, 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 3)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'platform', 2)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedTestData();
});

describe("GET /word-stats", () => {
  it("returns 200 with word table", async () => {
    const res = await SELF.fetch("http://localhost/word-stats");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ecosystem");
  });
});

describe("GET /word-stats/:word", () => {
  it("returns 200 with chunks containing word", async () => {
    const res = await SELF.fetch("http://localhost/word-stats/ecosystem");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ecosystem");
    expect(html).toContain("Chunk 1");
  });

  it("returns 404 for word not in word_stats", async () => {
    const res = await SELF.fetch("http://localhost/word-stats/nonexistent");
    expect(res.status).toBe(404);
  });
});
