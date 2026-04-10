import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedTestData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Bits and Bobs 4/8/24', '2024-04-08', 2024, 4, 8, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-03-25', 'Bits and Bobs 3/25/24', '2024-03-25', 2024, 3, 25, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1-2024-04-08', 'Chunk 1', 'content', 'ecosystem platform dynamics', 0)"),
    env.DB.prepare("INSERT INTO concordance (word, total_count, doc_count) VALUES ('ecosystem', 5, 2)"),
    env.DB.prepare("INSERT INTO concordance (word, total_count, doc_count) VALUES ('platform', 3, 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 3)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'platform', 2)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedTestData();
});

describe("GET /timeline", () => {
  it("returns 200 with years", async () => {
    const res = await SELF.fetch("http://localhost/timeline");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("2024");
  });
});

describe("GET /timeline/:year", () => {
  it("returns 200 with months for year", async () => {
    const res = await SELF.fetch("http://localhost/timeline/2024");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("April");
    expect(html).toContain("March");
  });

  it("returns 200 with empty state for year without episodes", async () => {
    const res = await SELF.fetch("http://localhost/timeline/1999");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No episodes in 1999");
  });
});

describe("GET /timeline/:year/:month", () => {
  it("returns 200 with episodes for month", async () => {
    const res = await SELF.fetch("http://localhost/timeline/2024/04");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bits and Bobs 4/8/24");
  });
});

describe("GET /timeline/:year/:month/:day", () => {
  it("redirects to episode page", async () => {
    const res = await SELF.fetch("http://localhost/timeline/2024/04/08", {
      redirect: "manual",
    });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("/episodes/2024-04-08");
  });
});

describe("GET /concordance", () => {
  it("returns 200 with word table", async () => {
    const res = await SELF.fetch("http://localhost/concordance");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ecosystem");
  });
});

describe("GET /concordance/:word", () => {
  it("returns 200 with chunks containing word", async () => {
    const res = await SELF.fetch("http://localhost/concordance/ecosystem");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ecosystem");
    expect(html).toContain("Chunk 1");
  });

  it("returns 404 for word not in concordance", async () => {
    const res = await SELF.fetch("http://localhost/concordance/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /sitemap.xml", () => {
  it("returns valid XML sitemap", async () => {
    const res = await SELF.fetch("http://localhost/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<urlset");
    expect(xml).toContain("/episodes/2024-04-08");
  });
});

describe("GET /feed.xml", () => {
  it("returns valid Atom feed", async () => {
    const res = await SELF.fetch("http://localhost/feed.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("atom+xml");
    const xml = await res.text();
    expect(xml).toContain("<feed");
    expect(xml).toContain("Bits and Bobs 4/8/24");
  });
});
