import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseSearchQuery } from "../lib/query-parser";
import { ftsSearch, mergeAndRerank, type ScoredResult } from "./search";
import { applyTopicBoost } from "./search-topics";

async function seedTopicSearchData() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Ep 1', '2024-04-08', 2024, 4, 8, 4)"
    ),
    // Chunk 1: mentions "ecosystem" in text AND is assigned to ecosystem topic
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-tagged', 'Ecosystem dynamics', 'The ecosystem evolves through ecosystem pressures.', 'The ecosystem evolves through ecosystem pressures.', 0)"
    ),
    // Chunk 2: mentions "ecosystem" in text but NOT assigned to ecosystem topic
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-untagged', 'Platform markets', 'The ecosystem is changing rapidly.', 'The ecosystem is changing rapidly.', 1)"
    ),
    // Chunk 3: assigned to ecosystem topic but uses different words (no "ecosystem" in text)
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-synonyms', 'Platform dynamics', 'Platform dynamics shape market evolution.', 'Platform dynamics shape market evolution.', 2)"
    ),
    // Chunk 4: assigned to agent topic only
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'agent-chunk', 'Agent systems', 'Autonomous agents orchestrate tasks using LLMs.', 'Autonomous agents orchestrate tasks using LLMs.', 3)"
    ),
    // Topics
    env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 10)"
    ),
    env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('agent', 'agent', 5)"
    ),
    // chunk_topics assignments
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"), // eco-assigned -> ecosystem
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"), // eco-synonyms -> ecosystem
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"), // agent-chunk -> agent
  ]);
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

    // eco-tagged should be boosted (it has the ecosystem topic)
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
    // but neither is assigned to "agent"
    const results = await ftsSearch(env.DB, parsed);
    expect(results).toHaveLength(0);
  });
});
