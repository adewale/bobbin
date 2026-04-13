import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedTestData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Bits and Bobs 4/8/24', '2024-04-08', 2024, 4, 8, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'ecosystem-chunk-2024-04-08', 'Ecosystem Dynamics', 'Ecosystem dynamics are fascinating', 'Ecosystem dynamics are fascinating', 0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 5)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedTestData();
});

describe("GET /search", () => {
  it("returns 200 with empty search form when no query", async () => {
    const res = await SELF.fetch("http://localhost/search");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Search");
    expect(html).toContain('name="q"');
  });

  it("returns search results for a keyword query", async () => {
    const res = await SELF.fetch("http://localhost/search?q=ecosystem");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ecosystem");
    expect(html).toContain("Ecosystem Dynamics");
  });
});

describe("GET /api/search", () => {
  it("returns JSON results", async () => {
    const res = await SELF.fetch("http://localhost/api/search?q=ecosystem");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.results).toHaveLength(1);
    expect(data.results[0].title).toBe("Ecosystem Dynamics");
  });

  it("returns empty results for empty query", async () => {
    const res = await SELF.fetch("http://localhost/api/search");
    const data = await res.json() as any;
    expect(data.results).toHaveLength(0);
  });
});

describe("Entity alias expansion in search", () => {
  beforeEach(async () => {
    // Add a chunk mentioning a known entity by alias
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'willison-chunk', 'Simon Willison post', 'Simon Willison shared a great insight about LLMs.', 'Simon Willison shared a great insight about LLMs.', 1)"
    ).run();
  });

  it("searching a known entity name returns results (not broken by OR expansion)", async () => {
    const res = await SELF.fetch("http://localhost/search?q=simon+willison");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Must find the chunk — the alias expansion must not break FTS5
    expect(html).toContain("Simon Willison");
    expect(html).not.toContain("0 result");
  });

  it("searching an entity alias returns results via expansion", async () => {
    const res = await SELF.fetch("http://localhost/search?q=willison");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Simon Willison");
  });

  it("quoted phrase search works for multi-word names", async () => {
    const res = await SELF.fetch('http://localhost/search?q=%22simon+willison%22');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Simon Willison");
  });
});

describe("GET /topics", () => {
  it("returns 200 with topic list", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ecosystem");
  });
});

describe("GET /topics/:slug", () => {
  it("returns 200 with chunks for topic", async () => {
    const res = await SELF.fetch("http://localhost/topics/ecosystem");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ecosystem");
    expect(html).toContain("Ecosystem Dynamics");
  });

  it("returns 404 for nonexistent topic", async () => {
    const res = await SELF.fetch("http://localhost/topics/nonexistent");
    expect(res.status).toBe(404);
  });
});
