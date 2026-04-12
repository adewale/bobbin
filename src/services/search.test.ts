import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseSearchQuery } from "../lib/query-parser";
import {
  ftsSearch,
  mergeAndRerank,
  type ScoredResult,
  type BoostConfig,
  DEFAULT_BOOSTS,
} from "./search";

async function seedSearchData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Ep 1', '2024-04-08', 2024, 4, 8, 3)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-title', 'Ecosystem dynamics are fascinating', 'Body about platforms.', 'Body about platforms.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-body', 'Platform markets', 'The ecosystem evolves through ecosystem pressures and ecosystem diversity.', 'The ecosystem evolves through ecosystem pressures and ecosystem diversity.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'no-match', 'Whale falls', 'Dead platforms become food.', 'Dead platforms become food.', 2)"),
  ]);

  // Create FTS table and populate
  await env.DB.exec("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, content_plain, content='chunks', content_rowid='id', tokenize='porter unicode61')");
  await env.DB.exec("INSERT INTO chunks_fts(rowid, title, content_plain) SELECT id, title, content_plain FROM chunks");
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedSearchData();
});

describe("ftsSearch", () => {
  it("returns matching chunks ranked by relevance", async () => {
    const results = await ftsSearch(env.DB, parseSearchQuery("ecosystem"));
    expect(results.length).toBeGreaterThan(0);
    // eco-body has "ecosystem" 3 times in body, eco-title has it once in title
    expect(results.some((r) => r.slug === "eco-body")).toBe(true);
    expect(results.some((r) => r.slug === "eco-title")).toBe(true);
  });

  it("does not return non-matching chunks", async () => {
    const results = await ftsSearch(env.DB, parseSearchQuery("ecosystem"));
    expect(results.every((r) => r.slug !== "no-match")).toBe(true);
  });

  it("returns empty array for no matches", async () => {
    const results = await ftsSearch(env.DB, parseSearchQuery("xyznonexistent"));
    expect(results).toHaveLength(0);
  });

  it("respects custom boost config — title boost changes ranking", async () => {
    // Different boost configs should produce different orderings
    const titleFirst: BoostConfig = { title: 100.0, content: 0.01 };
    const contentFirst: BoostConfig = { title: 0.01, content: 100.0 };
    const resultsTitle = await ftsSearch(env.DB, parseSearchQuery("ecosystem"), 20, titleFirst);
    const resultsContent = await ftsSearch(env.DB, parseSearchQuery("ecosystem"), 20, contentFirst);
    // Both return results
    expect(resultsTitle.length).toBeGreaterThan(0);
    expect(resultsContent.length).toBeGreaterThan(0);
    // The ranking should differ (or at least the scores should differ)
    expect(resultsTitle[0].score !== resultsContent[0].score || resultsTitle[0].slug !== resultsContent[0].slug).toBe(true);
  });

  it("respects custom boost config — content boost", async () => {
    // With high content boost, eco-body should rank first (has ecosystem 3x in body)
    const highContentBoost: BoostConfig = { title: 1.0, content: 10.0 };
    const results = await ftsSearch(env.DB, parseSearchQuery("ecosystem"), 20, highContentBoost);
    expect(results[0].slug).toBe("eco-body");
  });

  it("handles multi-word queries", async () => {
    const results = await ftsSearch(env.DB, parseSearchQuery("ecosystem diversity"));
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("mergeAndRerank", () => {
  const ftsResults: ScoredResult[] = [
    { id: 1, slug: "a", score: 0.9, source: "fts" },
    { id: 2, slug: "b", score: 0.7, source: "fts" },
    { id: 3, slug: "c", score: 0.5, source: "fts" },
  ];

  const vectorResults: ScoredResult[] = [
    { id: 2, slug: "b", score: 0.95, source: "vector" },
    { id: 4, slug: "d", score: 0.85, source: "vector" },
    { id: 5, slug: "e", score: 0.6, source: "vector" },
  ];

  it("deduplicates by id, keeping highest combined score", () => {
    const merged = mergeAndRerank(ftsResults, vectorResults);
    const ids = merged.map((r) => r.id);
    // No duplicates
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("boosts items appearing in both result sets", () => {
    const merged = mergeAndRerank(ftsResults, vectorResults);
    // Item 2 (slug "b") appears in both — should rank high
    const itemB = merged.find((r) => r.id === 2)!;
    const itemA = merged.find((r) => r.id === 1)!;
    // b has both FTS and vector scores, should outrank a (FTS only)
    expect(merged.indexOf(itemB)).toBeLessThan(merged.indexOf(itemA));
  });

  it("returns all unique items from both sets", () => {
    const merged = mergeAndRerank(ftsResults, vectorResults);
    expect(merged).toHaveLength(5); // a, b, c, d, e
  });

  it("sorts by combined score descending", () => {
    const merged = mergeAndRerank(ftsResults, vectorResults);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i - 1].score).toBeGreaterThanOrEqual(merged[i].score);
    }
  });

  it("handles empty FTS results", () => {
    const merged = mergeAndRerank([], vectorResults);
    expect(merged).toHaveLength(3);
  });

  it("handles empty vector results", () => {
    const merged = mergeAndRerank(ftsResults, []);
    expect(merged).toHaveLength(3);
  });
});

// Property-based tests
describe("mergeAndRerank properties", () => {
  function randomResults(n: number): ScoredResult[] {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      slug: `slug-${i}`,
      score: Math.random(),
      source: "fts" as const,
    }));
  }

  it("output length <= sum of input lengths", () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomResults(Math.floor(Math.random() * 10));
      const b = randomResults(Math.floor(Math.random() * 10)).map((r) => ({
        ...r,
        id: r.id + 100,
        source: "vector" as const,
      }));
      const merged = mergeAndRerank(a, b);
      expect(merged.length).toBeLessThanOrEqual(a.length + b.length);
    }
  });

  it("output is always sorted descending by score", () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomResults(Math.floor(Math.random() * 10));
      const b = randomResults(Math.floor(Math.random() * 10)).map((r) => ({
        ...r,
        id: r.id + 100,
        source: "vector" as const,
      }));
      const merged = mergeAndRerank(a, b);
      for (let i = 1; i < merged.length; i++) {
        expect(merged[i - 1].score).toBeGreaterThanOrEqual(merged[i].score);
      }
    }
  });

  it("no duplicate ids in output", () => {
    for (let trial = 0; trial < 20; trial++) {
      // Create overlapping IDs
      const a = randomResults(5);
      const b = randomResults(5).map((r, i) => ({
        ...r,
        id: i < 2 ? a[i].id : r.id + 100, // first 2 overlap
        source: "vector" as const,
      }));
      const merged = mergeAndRerank(a, b);
      const ids = merged.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every input id appears in output", () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomResults(5);
      const b = randomResults(5).map((r) => ({
        ...r,
        id: r.id + 100,
        source: "vector" as const,
      }));
      const merged = mergeAndRerank(a, b);
      const outputIds = new Set(merged.map((r) => r.id));
      for (const r of [...a, ...b]) {
        expect(outputIds.has(r.id)).toBe(true);
      }
    }
  });
});
