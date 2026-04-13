import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedTestData() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sources (google_doc_id, title) VALUES ('test-doc', 'Test')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, summary, chunk_count) VALUES (1, '2024-04-08', 'Bits and Bobs 4/8/24', '2024-04-08', 2024, 4, 8, 'A test episode', 2)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, summary, chunk_count) VALUES (1, '2024-03-25', 'Bits and Bobs 3/25/24', '2024-03-25', 2024, 3, 25, 'Another episode', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count) VALUES (1, 'nanotech-cages-2024-04-08', 'Nanotech cages for circus bears', 'The cages need to be built at the same scale.', 'The cages need to be built at the same scale.', 0, 10)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count) VALUES (1, 'frankenstein-ecosystems-2024-04-08', 'Frankenstein ecosystems', 'Stitching together platforms creates unpredictable results.', 'Stitching together platforms creates unpredictable results.', 1, 7)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count) VALUES (2, 'whale-falls-2024-03-25', 'Whale falls', 'Dead platforms become ecosystems.', 'Dead platforms become ecosystems.', 0, 5)"
    ),
    env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 2)"
    ),
    env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('platform', 'platform', 1)"
    ),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedTestData();
});

describe("GET /", () => {
  it("returns 200 with HTML", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("includes recent episodes in the margin", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    expect(html).toContain("Recent Episodes");
    expect(html).toContain("2024-04-08");
    expect(html).toContain("2024-03-25");
  });

  it("includes search form", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    expect(html).toContain('name="q"');
  });
});

describe("GET /episodes", () => {
  it("returns 200 with episode list", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Episodes");
    expect(html).toContain("Bits and Bobs 4/8/24");
  });
});

describe("GET /episodes/:slug", () => {
  it("returns 200 with episode detail and chunks", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bits and Bobs 4/8/24");
    expect(html).toContain("Nanotech cages for circus bears");
    expect(html).toContain("Frankenstein ecosystems");
  });

  it("returns 404 for nonexistent episode", async () => {
    const res = await SELF.fetch("http://localhost/episodes/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /chunks/:slug", () => {
  it("returns 200 with chunk content", async () => {
    const res = await SELF.fetch(
      "http://localhost/chunks/nanotech-cages-2024-04-08"
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Nanotech cages for circus bears");
    expect(html).toContain("same scale");
  });

  it("includes breadcrumb to parent episode", async () => {
    const res = await SELF.fetch(
      "http://localhost/chunks/nanotech-cages-2024-04-08"
    );
    const html = await res.text();
    expect(html).toContain("/episodes/2024-04-08");
    expect(html).toContain("Bits and Bobs 4/8/24");
  });

  it("returns 404 for nonexistent chunk", async () => {
    const res = await SELF.fetch("http://localhost/chunks/nonexistent");
    expect(res.status).toBe(404);
  });
});
