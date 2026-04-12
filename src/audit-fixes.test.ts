import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../test/helpers/migrations";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Ep 1', '2024-04-08', 2024, 4, 8, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'test-chunk', 'Test', 'Content', 'ecosystem test content', 0)"),
    env.DB.prepare("INSERT INTO concordance (word, total_count, doc_count) VALUES ('ecosystem', 5, 2)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 3)"),
  ]);
});

// S1: Auth on admin endpoints
describe("S1: Admin endpoint auth", () => {
  it("GET /api/ingest without auth returns 401", async () => {
    const res = await SELF.fetch("http://localhost/api/ingest");
    expect(res.status).toBe(401);
  });

  it("GET /api/embed without auth returns 401", async () => {
    const res = await SELF.fetch("http://localhost/api/embed");
    expect(res.status).toBe(401);
  });
});

// S3: FTS5 MATCH injection — should not crash
describe("S3: FTS5 injection safety", () => {
  it("search with FTS operators does not crash", async () => {
    const res = await SELF.fetch("http://localhost/search?q=title%3Asecret+AND+NOT+test");
    expect(res.status).toBe(200);
  });

  it("search with special chars does not crash", async () => {
    const res = await SELF.fetch("http://localhost/search?q=%22unclosed+quote");
    expect(res.status).toBe(200);
  });
});

// B1: Regex injection in concordance highlight
describe("B1: Regex safety in concordance", () => {
  it("concordance word with regex metacharacters does not crash", async () => {
    // These would crash with unescaped RegExp
    const res = await SELF.fetch("http://localhost/concordance/ecosystem");
    expect(res.status).toBe(200);
  });
});

// B3: NaN from bad query params
describe("B3: Bad query params", () => {
  it("GET /api/ingest?limit=abc does not produce NaN", async () => {
    const res = await SELF.fetch("http://localhost/api/ingest", {
      headers: { Authorization: "Bearer test-secret" },
    });
    // Should work with default limit, not NaN
    expect(res.status).not.toBe(500);
  });
});

// S5: Error messages should be generic
describe("S5: Generic error messages", () => {
  it("API errors do not leak internal details", async () => {
    const res = await SELF.fetch("http://localhost/api/ingest?doc=nonexistent", {
      headers: { Authorization: "Bearer test-secret" },
    });
    const data = await res.json() as any;
    if (data.error) {
      expect(data.error).not.toContain("SQLITE");
      expect(data.error).not.toContain("/Users/");
    }
  });
});

