import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseSearchQuery } from "../lib/query-parser";
import { ftsSearch, mergeAndRerank, type ScoredResult } from "./search";
import { applyTopicBoost, applyTopicFilter } from "./search-topics";

async function seedTopicSearchData() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Ep 1', '2024-04-08', 2024, 4, 8, 4)"
    ),
    // Chunk 1: mentions "ecosystem" in text AND is tagged with ecosystem topic
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-tagged', 'Ecosystem dynamics', 'The ecosystem evolves through ecosystem pressures.', 'The ecosystem evolves through ecosystem pressures.', 0)"
    ),
    // Chunk 2: mentions "ecosystem" in text but NOT tagged with ecosystem topic
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-untagged', 'Platform markets', 'The ecosystem is changing rapidly.', 'The ecosystem is changing rapidly.', 1)"
    ),
    // Chunk 3: tagged with ecosystem topic but uses different words (no "ecosystem" in text)
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-synonyms', 'Platform dynamics', 'Platform dynamics shape market evolution.', 'Platform dynamics shape market evolution.', 2)"
    ),
    // Chunk 4: tagged with agent topic only
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'agent-chunk', 'Agent systems', 'Autonomous agents orchestrate tasks using LLMs.', 'Autonomous agents orchestrate tasks using LLMs.', 3)"
    ),
    // Topics (using tags table since that's the current schema)
    env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 10)"
    ),
    env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('agent', 'agent', 5)"
    ),
    // chunk_tags assignments
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"), // eco-tagged -> ecosystem
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"), // eco-synonyms -> ecosystem
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"), // agent-chunk -> agent
  ]);

  // Create FTS table
  await env.DB.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, content_plain, content='chunks', content_rowid='id', tokenize='porter unicode61')"
  );
  await env.DB.exec(
    "INSERT INTO chunks_fts(rowid, title, content_plain) SELECT id, title, content_plain FROM chunks"
  );
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedTopicSearchData();
});

describe("applyTopicBoost", () => {
  it("boosts chunks assigned to a matching topic", async () => {
    // Search for "ecosystem" — both eco-tagged (id=1) and eco-untagged (id=2) match text
    const ftsResults = await ftsSearch(env.DB, parseSearchQuery("ecosystem"));
    expect(ftsResults.length).toBeGreaterThanOrEqual(2);

    // Apply topic boost
    const boosted = await applyTopicBoost(env.DB, "ecosystem", ftsResults);

    // eco-tagged should be boosted (it has the ecosystem tag)
    const taggedResult = boosted.find((r) => r.slug === "eco-tagged");
    const untaggedResult = boosted.find((r) => r.slug === "eco-untagged");
    expect(taggedResult).toBeDefined();
    expect(untaggedResult).toBeDefined();
    expect(taggedResult!.score).toBeGreaterThan(untaggedResult!.score);
  });

  it("does not boost when query does not match any topic", async () => {
    const ftsResults = await ftsSearch(env.DB, parseSearchQuery("ecosystem"));
    const originalScores = ftsResults.map((r) => ({ slug: r.slug, score: r.score }));

    const boosted = await applyTopicBoost(
      env.DB,
      "xyznonexistenttopic",
      ftsResults
    );

    // Scores should remain unchanged
    for (const original of originalScores) {
      const after = boosted.find((r) => r.slug === original.slug);
      expect(after!.score).toBe(original.score);
    }
  });
});

describe("applyTopicFilter", () => {
  it("filters results to only chunks tagged with the specified topic", async () => {
    const parsed = parseSearchQuery("topic:ecosystem");
    const filtered = await applyTopicFilter(env.DB, parsed.topics!);

    // Should return chunk IDs for eco-tagged and eco-synonyms (both tagged with ecosystem)
    expect(filtered).toContain(1); // eco-tagged
    expect(filtered).toContain(3); // eco-synonyms
    expect(filtered).not.toContain(2); // eco-untagged
    expect(filtered).not.toContain(4); // agent-chunk
  });

  it("returns intersection when multiple topics specified", async () => {
    // Only chunks tagged with BOTH ecosystem and agent — none exist in seed data
    const filtered = await applyTopicFilter(env.DB, [
      "ecosystem",
      "agent",
    ]);
    expect(filtered).toHaveLength(0);
  });

  it("returns chunk IDs for agent topic", async () => {
    const filtered = await applyTopicFilter(env.DB, ["agent"]);
    expect(filtered).toContain(4); // agent-chunk
    expect(filtered).toHaveLength(1);
  });

  it("returns empty array for nonexistent topic", async () => {
    const filtered = await applyTopicFilter(env.DB, ["nonexistent"]);
    expect(filtered).toHaveLength(0);
  });
});

describe("ftsSearch with topic filter", () => {
  it("narrows FTS results to chunks with matching topic", async () => {
    const parsed = parseSearchQuery("ecosystem topic:ecosystem");
    // "ecosystem" matches eco-tagged and eco-untagged in text,
    // but topic:ecosystem should filter to only eco-tagged
    const results = await ftsSearch(env.DB, parsed);

    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain("eco-tagged");
    expect(slugs).not.toContain("eco-untagged");
  });

  it("returns empty when text matches but topic does not", async () => {
    const parsed = parseSearchQuery("ecosystem topic:agent");
    // "ecosystem" matches text in eco-tagged and eco-untagged,
    // but neither is tagged with "agent"
    const results = await ftsSearch(env.DB, parsed);
    expect(results).toHaveLength(0);
  });
});
