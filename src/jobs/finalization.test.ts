/**
 * Tests for self-healing finalization steps.
 * Each step runs automatically during finalizeEnrichment.
 *
 * Testing approach: real D1 database (no mocks), each test seeds specific
 * data that exercises the cleanup step, then verifies both positive
 * (bad data removed) and negative (good data preserved) outcomes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { finalizeEnrichment, enrichChunks, enrichAllChunks } from "./ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 4)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1', 'Chunk 1', 'The ecosystem evolves through platform dynamics and network effects.', 'The ecosystem evolves through platform dynamics and network effects.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-2', 'Chunk 2', 'Geoffrey Litt writes about malleable software and end-user programming.', 'Geoffrey Litt writes about malleable software and end-user programming.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-3', 'Chunk 3', 'Little things add up over time into something big.', 'Little things add up over time into something big.', 2)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-4', 'Chunk 4', 'Geoffrey Litt also presented at the conference about malleable tools.', 'Geoffrey Litt also presented at the conference about malleable tools.', 3)"),
  ]);
});

describe("Entity validation (Issue 1)", () => {
  beforeEach(async () => {
    // Entity topic with 3 assignments: 2 correct (chunk-2, chunk-4 mention Geoffrey Litt), 1 false (chunk-3 says "Little")
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('geoffrey litt', 'geoffrey-litt', 'entity', 3)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)").run(); // false
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)").run();
  });

  it("removes false entity assignments where chunk lacks the entity name", async () => {
    await finalizeEnrichment(env.DB);
    const remaining = await env.DB.prepare("SELECT chunk_id FROM chunk_topics WHERE topic_id = 1 ORDER BY chunk_id").all();
    const chunkIds = remaining.results.map((r: any) => r.chunk_id);
    // chunk-3 (false match for "Little") should be removed
    expect(chunkIds).not.toContain(3);
    // chunk-2 and chunk-4 (real Geoffrey Litt mentions) should survive
    expect(chunkIds).toContain(2);
    expect(chunkIds).toContain(4);
    expect(chunkIds.length).toBe(2);
  });

  it("preserves non-entity topics (validation only applies to kind=entity)", async () => {
    // Add a concept topic — it should NOT be validated against text content
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('ecosystem', 'ecosystem', 'concept', 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)").run(); // chunk-3 doesn't say "ecosystem" but that's fine for concepts

    await finalizeEnrichment(env.DB);

    const conceptRemaining = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 2").first<{ c: number }>();
    expect(conceptRemaining!.c).toBe(2); // both preserved — concepts aren't validated
  });
});

describe("Usage=1 prune (Issue 3)", () => {
  it("zeros usage for single-occurrence topics and preserves multi-use topics", async () => {
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('rare-word', 'rare-word', 1)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('popular', 'popular', 5)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)").run();

    await finalizeEnrichment(env.DB);

    // rare-word should be pruned (usage zeroed, chunk_topics deleted)
    const rare = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'rare-word'").first<any>();
    expect(rare.usage_count).toBe(0);
    const rareLinks = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 1").first<{ c: number }>();
    expect(rareLinks!.c).toBe(0);

    // popular should survive with correct usage count
    const popular = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'popular'").first<any>();
    expect(popular.usage_count).toBeGreaterThan(0);
  });
});

describe("enrichAllChunks (Issue 4)", () => {
  it("enriches chunks by looping internally within time budget", async () => {
    const total = await enrichAllChunks(env.DB, 10, 15000);
    expect(total).toBeGreaterThanOrEqual(3);

    const unenriched = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE id NOT IN (SELECT DISTINCT chunk_id FROM chunk_topics)"
    ).first<{ c: number }>();
    // At most 1 unenriched (very short chunks may produce no topics)
    expect(unenriched!.c).toBeLessThanOrEqual(1);
  });

  it("terminates when no more chunks to process (does not loop forever)", async () => {
    // First run enriches all chunks
    await enrichAllChunks(env.DB, 100, 5000);
    // Second run should terminate quickly (0 or minimal — some edge cases may re-process)
    const secondRun = await enrichAllChunks(env.DB, 100, 2000);
    // The key property: it terminates within the time budget, doesn't loop forever
    expect(secondRun).toBeLessThanOrEqual(4); // at most the 4 chunks in seed data
  });
});

describe("Noise cleanup (Issue 5)", () => {
  it("removes chunk_topics for noise-word topics and zeros their usage", async () => {
    // "system" and "software" are in NOISE_WORDS
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('system', 'system', 3)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('software', 'software', 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)").run();

    await finalizeEnrichment(env.DB);

    // Both noise topics should have 0 chunk_topics
    const systemLinks = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 1").first<{ c: number }>();
    expect(systemLinks!.c).toBe(0);
    const softwareLinks = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 2").first<{ c: number }>();
    expect(softwareLinks!.c).toBe(0);

    // Usage counts should be 0
    const systemTopic = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'system'").first<any>();
    expect(systemTopic.usage_count).toBe(0);
  });

  it("does NOT remove entity assignments where chunk genuinely mentions the entity", async () => {
    // Add chunks that mention "meta" (the company)
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'meta-chunk', 'Meta news', 'Meta announced new AI features for Instagram.', 'Meta announced new AI features for Instagram.', 4)"
    ).run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('meta', 'meta', 'entity', 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)").run(); // correct: chunk mentions Meta
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run(); // false: chunk-1 doesn't mention Meta

    await finalizeEnrichment(env.DB);

    // Only the chunk that actually mentions Meta should survive
    const remaining = await env.DB.prepare("SELECT chunk_id FROM chunk_topics WHERE topic_id = 1").all();
    const chunkIds = remaining.results.map((r: any) => r.chunk_id);
    expect(chunkIds).toContain(5); // real mention preserved
    expect(chunkIds).not.toContain(1); // false match removed
  });
});

describe("Related slugs computation", () => {
  beforeEach(async () => {
    // We need more than 4 chunks to have enough chunk_topics for usage >= 5
    // Add extra chunks to the base seed data (which already has 4 chunks)
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-5', 'Chunk 5', 'Alpha and beta concepts in production.', 'Alpha and beta concepts in production.', 4)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-6', 'Chunk 6', 'Alpha and beta revisited for scale.', 'Alpha and beta revisited for scale.', 5)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-7', 'Chunk 7', 'More alpha coverage in this chunk.', 'More alpha coverage in this chunk.', 6)"),
    ]);
  });

  it("computes related_slugs for topics with usage >= 5 via batch SQL", async () => {
    // Create two topics that co-occur in multiple chunks
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('alpha', 'alpha', 'concept', 0)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('beta', 'beta', 'concept', 0)").run();

    // Alpha assigned to 6 chunks, beta assigned to 5 chunks — both will have usage >= 5 after recount
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
    ]);

    await finalizeEnrichment(env.DB);

    // Alpha (usage 6 after recount) should have beta as related
    const alpha = await env.DB.prepare("SELECT related_slugs FROM topics WHERE slug = 'alpha'").first<{ related_slugs: string | null }>();
    expect(alpha).not.toBeNull();
    expect(alpha!.related_slugs).not.toBeNull();
    const alphaParsed = JSON.parse(alpha!.related_slugs!);
    expect(alphaParsed).toContain("beta");

    // Beta (usage 5 after recount) should have alpha as related
    const beta = await env.DB.prepare("SELECT related_slugs FROM topics WHERE slug = 'beta'").first<{ related_slugs: string | null }>();
    expect(beta).not.toBeNull();
    expect(beta!.related_slugs).not.toBeNull();
    const betaParsed = JSON.parse(beta!.related_slugs!);
    expect(betaParsed).toContain("alpha");
  });

  it("produces valid JSON array format for related_slugs", async () => {
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('topicA', 'topic-a', 'concept', 0)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('topicB', 'topic-b', 'concept', 0)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('topicC', 'topic-c', 'concept', 0)").run();

    // topicA assigned to 6 chunks, topicB to 5, topicC to 5 — all >= 5 after recount
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 3)"),
    ]);

    await finalizeEnrichment(env.DB);

    const topicA = await env.DB.prepare("SELECT related_slugs FROM topics WHERE slug = 'topic-a'").first<{ related_slugs: string | null }>();
    expect(topicA).not.toBeNull();
    expect(topicA!.related_slugs).not.toBeNull();

    // Verify it's valid JSON array
    const parsed = JSON.parse(topicA!.related_slugs!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    // Each element should be a string slug
    for (const slug of parsed) {
      expect(typeof slug).toBe("string");
    }
  });
});

describe("N-gram phrase topics (inline without queue)", () => {
  it("creates phrase topics from n-gram extraction when enough data exists", async () => {
    // Need at least 10 chunks with repeated phrases for n-gram extraction to work
    // Insert many chunks with a common phrase appearing in multiple docs
    const phrase = "machine learning";
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 15; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, ?, ?, ?)"
        ).bind(
          `ngram-chunk-${i}`,
          `Chunk ${i}`,
          `This chunk discusses ${phrase} and deep ${phrase} models in production.`,
          `This chunk discusses ${phrase} and deep ${phrase} models in production.`,
          i + 10
        )
      );
    }
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }

    // Run finalization without queue — n-grams should be processed inline
    await finalizeEnrichment(env.DB);

    // Check that a phrase topic was created (any topic with kind='phrase')
    const phrases = await env.DB.prepare(
      "SELECT name, slug, kind FROM topics WHERE kind = 'phrase'"
    ).all<{ name: string; slug: string; kind: string }>();

    // The "machine learning" phrase should appear frequently enough to be extracted
    const hasPhraseTopic = phrases.results.some(t => t.name.includes("machine") && t.name.includes("learning"));
    expect(hasPhraseTopic).toBe(true);
  });
});
