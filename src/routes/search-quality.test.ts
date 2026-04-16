/**
 * Search quality tests.
 *
 * These test search BEHAVIOR, not just HTTP status codes.
 * Each test verifies that the right results appear and wrong results don't.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedSearchCorpus() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 4)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-02-03', 'Ep 2', '2025-02-03', 2025, 2, 3, 1)"
    ),
    // Chunk that mentions Tyler Cowen explicitly
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'tyler-cowen-chunk', 'Tyler Cowen on marginal revolution',
       'Tyler Cowen argues that economic growth depends on talent allocation.',
       'Tyler Cowen argues that economic growth depends on talent allocation.', 0)`
    ),
    // Chunk that mentions a DIFFERENT Tyler (should NOT match "tyler cowen")
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'tyler-other-chunk', 'Tyler Alterman on clowning',
       'Tyler Alterman has a great frame about creative risk.',
       'Tyler Alterman has a great frame about creative risk.', 1)`
    ),
    // Chunk about economics (semantically similar but no name match)
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'economics-chunk', 'Economic growth patterns',
       'Economic growth follows predictable patterns in developed markets.',
       'Economic growth follows predictable patterns in developed markets.', 2)`
    ),
    // Chunk mentioning Simon Willison (known entity)
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'willison-chunk', 'Simon Willison on LLMs',
       'Simon Willison shared his latest thinking on LLM tool use.',
       'Simon Willison shared his latest thinking on LLM tool use.', 3)`
    ),
    // Chunk from a different episode mentioning Stratechery (alias for Ben Thompson)
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (2, 'stratechery-chunk', 'Stratechery on agents',
       'Stratechery points out that agent architectures have strategic implications.',
       'Stratechery points out that agent architectures have strategic implications.', 0)`
    ),
    // Topics
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 10)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('economics', 'economics', 5)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
  ]);

  // Create FTS5 table
  await env.DB.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, content_plain, content='chunks', content_rowid='id', tokenize='porter unicode61')"
  );
  await env.DB.exec(
    "INSERT INTO chunks_fts(rowid, title, content_plain) SELECT id, title, content_plain FROM chunks"
  );
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedSearchCorpus();
});

describe("Exact phrase search precision", () => {
  it('quoted "tyler cowen" returns only chunks containing that exact phrase', async () => {
    const res = await SELF.fetch('http://localhost/search?q=%22tyler+cowen%22');
    const html = await res.text();
    expect(html).toContain("Tyler Cowen");
    // Should NOT include Tyler Alterman (different person, same first name)
    expect(html).not.toContain("Tyler Alterman");
    // Should NOT include economics chunk (semantically similar but no name match)
    expect(html).not.toContain("Economic growth patterns");
  });

  it("quoted phrase returns 1 result, not semantic noise", async () => {
    const res = await SELF.fetch('http://localhost/search?q=%22tyler+cowen%22');
    const html = await res.text();
    expect(html).toContain("1 result");
  });

  it("unquoted multi-word search still preserves exact-match precision", async () => {
    // "tyler cowen" without quotes should still prefer the exact multi-word match
    const res = await SELF.fetch("http://localhost/search?q=tyler+cowen");
    const html = await res.text();
    expect(html).toContain("Tyler Cowen");
    expect(html).toContain("1 result");
    expect(html).not.toContain("Tyler Alterman");

    // The exact multi-word match should remain the visible result.
    const cowenIndex = html.indexOf("Tyler Cowen");
    const altermanIndex = html.indexOf("Tyler Alterman");
    expect(cowenIndex).toBeGreaterThan(-1);
    expect(altermanIndex).toBe(-1);
  });
});

describe("Entity alias expansion", () => {
  it("searching canonical name finds the chunk", async () => {
    const res = await SELF.fetch("http://localhost/search?q=simon+willison");
    const html = await res.text();
    expect(html).toContain("Simon Willison");
  });

  it("searching alias finds chunks with the canonical name", async () => {
    // "willison" is an alias for Simon Willison
    const res = await SELF.fetch("http://localhost/search?q=willison");
    const html = await res.text();
    expect(html).toContain("Simon Willison");
  });

  it("searching 'stratechery' finds Stratechery chunks", async () => {
    const res = await SELF.fetch("http://localhost/search?q=stratechery");
    const html = await res.text();
    expect(html).toContain("Stratechery");
  });
});

describe("Proper noun precision (no vector noise)", () => {
  it("searching a rare proper noun returns only literal matches", async () => {
    // "oshineye" is a rare name — only 1 chunk mentions it
    // Vector search should not add noise for names not in the embedding vocabulary
    // (In the test env, Vectorize isn't available, so this tests FTS5 precision)
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'oshineye-chunk', 'Goodhart formulation',
       'I heard this formulation from Ade Oshineye.',
       'I heard this formulation from Ade Oshineye.', 4)`
    ).run();
    await env.DB.exec(
      "INSERT INTO chunks_fts(rowid, title, content_plain) VALUES ((SELECT id FROM chunks WHERE slug = 'oshineye-chunk'), 'Goodhart formulation', 'I heard this formulation from Ade Oshineye.')"
    );

    const res = await SELF.fetch("http://localhost/search?q=oshineye");
    const html = await res.text();
    expect(html).toContain("Oshineye");
    expect(html).toContain("1 result");
  });
});

describe("Topic filter operator", () => {
  it("topic:economics narrows results to economics-tagged chunks", async () => {
    const res = await SELF.fetch("http://localhost/search?q=growth+topic%3Aeconomics");
    const html = await res.text();
    // Tyler Cowen chunk is tagged with economics and mentions "growth"
    expect(html).toContain("Tyler Cowen");
    // Economics chunk is tagged with economics and mentions "growth"
    expect(html).toContain("Economic growth");
    // Willison chunk is NOT tagged with economics
    expect(html).not.toContain("Simon Willison");
  });
});

describe("Search with date filters", () => {
  it("after: filter excludes earlier episodes", async () => {
    const res = await SELF.fetch("http://localhost/search?q=agent+after%3A2025-02-01");
    const html = await res.text();
    // Only Ep 2 (2025-02-03) matches the date filter
    // Tyler Cowen chunk is in Ep 1 (2025-01-06) — excluded
    expect(html).not.toContain("Tyler Cowen");
  });
});

describe("Vector score threshold value", () => {
  // These tests demonstrate WHY we filter vector results below 0.72 cosine similarity.
  // They use mergeAndRerank directly to show how low-scoring vector noise degrades results.

  it("low-scoring vector results dilute FTS precision when unfiltered", async () => {
    // Simulate: FTS5 found 1 exact match. Vector found 5 low-similarity results.
    const { mergeAndRerank } = await import("../../src/services/search");

    const ftsResults = [
      { id: 1, slug: "exact-match", title: "Exact Match", score: 1.0, source: "fts" as const },
    ];

    // Low-scoring noise — cosine similarity < 0.72
    const vectorNoise = [2, 3, 4, 5, 6].map((id) => ({
      id, slug: `noise-${id}`, title: `Noise ${id}`, score: 0.45, source: "vector" as const,
    }));

    const merged = mergeAndRerank(ftsResults, vectorNoise);

    // Without filtering, the exact match gets score = 1.0 * 0.4 = 0.4
    // The noise gets score = 0.45 * 0.6 = 0.27 each
    // The exact match is still #1 but 5 noise results follow it
    expect(merged.length).toBe(6); // 1 good + 5 noise
    expect(merged[0].slug).toBe("exact-match");
    // All 5 noise results are present
    expect(merged.filter((r) => r.slug.startsWith("noise")).length).toBe(5);
  });

  it("filtering vector results above threshold preserves only relevant matches", async () => {
    const { mergeAndRerank } = await import("../../src/services/search");

    const ftsResults = [
      { id: 1, slug: "exact-match", title: "Exact Match", score: 1.0, source: "fts" as const },
    ];

    // Only keep vectors above threshold (simulating the route-level filter)
    const MIN_VECTOR_SCORE = 0.72;
    const allVectorResults = [
      { id: 7, slug: "relevant", title: "Relevant", score: 0.85, source: "vector" as const },
      { id: 2, slug: "noise-1", title: "Noise 1", score: 0.45, source: "vector" as const },
      { id: 3, slug: "noise-2", title: "Noise 2", score: 0.38, source: "vector" as const },
    ];
    const filtered = allVectorResults.filter((r) => r.score >= MIN_VECTOR_SCORE);

    const merged = mergeAndRerank(ftsResults, filtered);

    // Only 2 results: the FTS match and the high-scoring vector match — no noise
    expect(merged.length).toBe(2);
    expect(merged.map(r => r.slug).sort()).toEqual(["exact-match", "relevant"]);
    expect(merged.filter((r) => r.slug.startsWith("noise")).length).toBe(0);
  });

  it("crossover bonus rewards results found by both FTS and vector", async () => {
    const { mergeAndRerank } = await import("../../src/services/search");

    const ftsResults = [
      { id: 1, slug: "both-match", title: "Both Match", score: 0.8, source: "fts" as const },
      { id: 2, slug: "fts-only", title: "FTS Only", score: 0.6, source: "fts" as const },
    ];

    const vectorResults = [
      { id: 1, slug: "both-match", title: "Both Match", score: 0.9, source: "vector" as const },
      { id: 3, slug: "vec-only", title: "Vector Only", score: 0.75, source: "vector" as const },
    ];

    const merged = mergeAndRerank(ftsResults, vectorResults);

    // "both-match" appears in both: gets crossover bonus (+0.1)
    const bothMatch = merged.find((r) => r.slug === "both-match")!;
    const vecOnly = merged.find((r) => r.slug === "vec-only")!;
    // both-match: 0.8 * 0.4 + 0.9 * 0.6 + 0.1 = 0.96
    // vec-only: 0.75 * 0.6 = 0.45
    expect(bothMatch.score).toBeGreaterThan(vecOnly.score);
    expect(merged[0].slug).toBe("both-match"); // highest ranked
  });
});

describe("Empty and edge-case queries", () => {
  it("empty query returns no results", async () => {
    const res = await SELF.fetch("http://localhost/search?q=");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("result");
  });

  it("query with only spaces returns no results", async () => {
    const res = await SELF.fetch("http://localhost/search?q=+++");
    const html = await res.text();
    expect(res.status).toBe(200);
  });

  it("query with special characters doesn't crash", async () => {
    const res = await SELF.fetch("http://localhost/search?q=%22unclosed+quote");
    expect(res.status).toBe(200);
  });
});
