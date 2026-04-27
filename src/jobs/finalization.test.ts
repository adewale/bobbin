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
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-13', 'Ep 2', '2025-01-13', 2025, 1, 13, 4)"),
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
    // Add a concept topic with df≥5 so it survives the quality gate
    // Entity validation should NOT remove its chunk_topics (only entities are validated)
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('ecosystem', 'ecosystem', 'concept', 5)").run();
    // Need 5 chunk_topics links for it to survive df≥5 gate
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-5', 'C5', 'Eco chunk.', 'Eco chunk.', 0)"
    ).run();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
      env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
      env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
    ]);

    await finalizeEnrichment(env.DB);

    const conceptRemaining = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 1").first<{ c: number }>();
    expect(conceptRemaining!.c).toBeGreaterThan(0); // concepts are not wiped out by entity validation
  });

  it("removes invalid entity assignments in batches when the cleanup set exceeds the D1 bind cap", async () => {
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, kind, usage_count) VALUES ('large entity', 'large-entity', 'entity', 121)"
    ).run();

    const chunkInserts = Array.from({ length: 120 }, (_, index) => {
      const n = index + 1;
      return env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, ?, ?, ?)"
      ).bind(
        `large-entity-${n}`,
        `Large entity ${n}`,
        `This chunk talks about something else ${n}.`,
        `This chunk talks about something else ${n}.`,
        n + 10,
      );
    });
    await env.DB.batch(chunkInserts);

    const invalidAssignments = Array.from({ length: 120 }, (_, index) =>
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 2)").bind(index + 5)
    );
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      ...invalidAssignments,
    ]);

    await finalizeEnrichment(env.DB);

    const remaining = await env.DB.prepare(
      "SELECT chunk_id FROM chunk_topics WHERE topic_id = 2 ORDER BY chunk_id"
    ).all<{ chunk_id: number }>();
    const remainingIds = remaining.results.map((row) => row.chunk_id);

    expect(remainingIds).toHaveLength(0);
    expect(remainingIds).not.toContain(1);
    expect(remainingIds).not.toContain(125);
  });
});

describe("Document frequency quality gate (df≥5)", () => {
  it("prunes topics with df<5 and preserves topics with df≥5", async () => {
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('rare-word', 'rare-word', 2)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('popular', 'popular', 5)").run();
    // rare-word: df=2 (below threshold)
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)").run();
    // popular: df=5 (at threshold — survives)
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)").run();

    // Need 5th chunk for popular
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-5', 'C5', 'Popular topic here.', 'Popular topic here.', 0)"
    ).run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)").run();

    await finalizeEnrichment(env.DB);

    // rare-word (df=2) should be pruned (deleted by orphan cleanup)
    const rare = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'rare-word'").first<any>();
    expect(!rare || rare.usage_count === 0).toBe(true);

    // popular (df=5) should survive
    const popular = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'popular'").first<any>();
    expect(popular.usage_count).toBeGreaterThanOrEqual(5);
  });

  it("uses a corpus-relative episode-support threshold instead of a fixed usage threshold", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-20', 'Ep 3', '2025-01-20', 2025, 1, 20, 1)"),
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-27', 'Ep 4', '2025-01-27', 2025, 1, 27, 1)"),
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-02-03', 'Ep 5', '2025-02-03', 2025, 2, 3, 1)"),
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-02-10', 'Ep 6', '2025-02-10', 2025, 2, 10, 1)"),
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-02-17', 'Ep 7', '2025-02-17', 2025, 2, 17, 1)"),
      env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-02-24', 'Ep 8', '2025-02-24', 2025, 2, 24, 1)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'chunk-5', 'C5', 'Threshold topic.', 'Threshold topic.', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (4, 'chunk-6', 'C6', 'Threshold topic.', 'Threshold topic.', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (5, 'chunk-7', 'C7', 'Threshold topic.', 'Threshold topic.', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (6, 'chunk-8', 'C8', 'Weak topic.', 'Weak topic.', 0)"),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('threshold survivor', 'threshold-survivor', 3)"),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('threshold prune', 'threshold-prune', 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 2)"),
    ]);

    await finalizeEnrichment(env.DB);

    const survivor = await env.DB.prepare("SELECT episode_support, usage_count FROM topics WHERE slug = 'threshold-survivor'").first<{ episode_support: number; usage_count: number }>();
    const pruned = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'threshold-prune'").first<{ usage_count: number } | null>();

    expect(survivor).not.toBeNull();
    expect(survivor!.episode_support).toBe(3);
    expect(survivor!.usage_count).toBeGreaterThan(0);
    expect(!pruned || pruned.usage_count === 0).toBe(true);
  });
});

describe("enrichAllChunks (Issue 4)", () => {
  it("enriches chunks by looping internally within time budget", async () => {
    const total = await enrichAllChunks(env.DB, 10, 15000);
    expect(total).toBeGreaterThanOrEqual(3);

    const unenriched = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE enriched = 0 OR enrichment_version < 5"
    ).first<{ c: number }>();
    expect(unenriched!.c).toBe(0);
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
    // Noise topics deleted by orphan cleanup
    const systemTopic = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'system'").first<any>();
    expect(!systemTopic || systemTopic.usage_count === 0).toBe(true);
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
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-6', 'Chunk 6', 'Alpha and beta revisited for scale.', 'Alpha and beta revisited for scale.', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-7', 'Chunk 7', 'More alpha coverage in this chunk.', 'More alpha coverage in this chunk.', 1)"),
    ]);
  });

  it("computes related_slugs for topics with usage >= 5 via batch SQL", async () => {
    // Create two topics that co-occur in multiple chunks
    await env.DB.batch([
      env.DB.prepare("UPDATE chunks SET content_plain = 'Alpha Corp and Beta Corp co-occur here' WHERE id = 1"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Alpha Corp and Beta Corp appear together again' WHERE id = 2"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Alpha Corp and Beta Corp show up again' WHERE id = 3"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Alpha Corp and Beta Corp remain linked' WHERE id = 4"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Alpha Corp and Beta Corp in production' WHERE id = 5"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Alpha Corp and Beta Corp revisited for scale' WHERE id = 6"),
    ]);
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count, distinctiveness) VALUES ('alpha corp', 'alpha-corp', 'entity', 0, 30)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count, distinctiveness) VALUES ('beta corp', 'beta-corp', 'entity', 0, 30)").run();

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
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
    ]);

    await finalizeEnrichment(env.DB);

    // Alpha (usage 6 after recount) should have beta as related
    const alpha = await env.DB.prepare("SELECT related_slugs FROM topics WHERE slug = 'alpha-corp'").first<{ related_slugs: string | null }>();
    expect(alpha).not.toBeNull();
    expect(alpha!.related_slugs).not.toBeNull();
    const alphaParsed = JSON.parse(alpha!.related_slugs!);
    expect(alphaParsed).toContain("beta-corp");

    // Beta (usage 5 after recount) should have alpha as related
    const beta = await env.DB.prepare("SELECT related_slugs FROM topics WHERE slug = 'beta-corp'").first<{ related_slugs: string | null }>();
    expect(beta).not.toBeNull();
    expect(beta!.related_slugs).not.toBeNull();
    const betaParsed = JSON.parse(beta!.related_slugs!);
    expect(betaParsed).toContain("alpha-corp");
  });

  it("produces valid JSON array format for related_slugs", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE chunks SET content_plain = 'Atlas Labs meets Zephyr Labs and Quartz Labs' WHERE id = 1"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Atlas Labs works with Zephyr Labs and Quartz Labs' WHERE id = 2"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Atlas Labs joins Zephyr Labs and Quartz Labs' WHERE id = 3"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Atlas Labs scales with Zephyr Labs and Quartz Labs' WHERE id = 4"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Atlas Labs returns with Zephyr Labs and Quartz Labs' WHERE id = 5"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Atlas Labs appears in episode two with Zephyr Labs and Quartz Labs' WHERE id = 6"),
    ]);
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count, distinctiveness) VALUES ('atlas labs', 'atlas-labs', 'entity', 0, 30)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count, distinctiveness) VALUES ('zephyr labs', 'zephyr-labs', 'entity', 0, 30)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count, distinctiveness) VALUES ('quartz labs', 'quartz-labs', 'entity', 0, 30)").run();

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
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 3)"),
    ]);

    await finalizeEnrichment(env.DB);

    const topicA = await env.DB.prepare("SELECT related_slugs FROM topics WHERE id = 1").first<{ related_slugs: string | null }>();
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

  it("computes similarity-backed related topics from cached chunk embeddings", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('alpha engine', 'alpha-engine', 'concept', 0)"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('beta lattice', 'beta-lattice', 'concept', 0)"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('gamma harbor', 'gamma-harbor', 'concept', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-8', 'Chunk 8', 'Alpha beta continuation.', 'Alpha beta continuation.', 2)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-9', 'Chunk 9', 'Gamma beta continuation.', 'Gamma beta continuation.', 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (9, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (9, 3)"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (1, '[1,0,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (2, '[0.9,0.1,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (3, '[0.95,0.05,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (4, '[0.2,0.8,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (8, '[0.98,0.02,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (9, '[0.15,0.85,0]')"),
      env.DB.prepare("INSERT INTO topic_dirty (topic_id, reason) VALUES (1, 'test')"),
      env.DB.prepare("INSERT INTO topic_dirty (topic_id, reason) VALUES (2, 'test')"),
      env.DB.prepare("INSERT INTO topic_dirty (topic_id, reason) VALUES (3, 'test')"),
    ]);

    const result = await finalizeEnrichment(env.DB);
    const similarityStep = result.steps.find((step) => step.name === 'topic_similarity');
    const related = await env.DB.prepare("SELECT related_slugs FROM topics WHERE slug = 'alpha-engine'").first<{ related_slugs: string | null }>();
    const score = await env.DB.prepare(
      "SELECT cosine_score, jaccard_score, combined_score FROM topic_similarity_scores WHERE topic_id = 1 AND related_topic_id = 2"
    ).first<{ cosine_score: number | null; jaccard_score: number; combined_score: number }>();

    expect(similarityStep).toBeDefined();
    expect(similarityStep!.counts.topic_pairs_written).toBeGreaterThan(0);
    expect(related).not.toBeNull();
    expect(JSON.parse(related!.related_slugs || '[]')).toContain('beta-lattice');
    expect(score).not.toBeNull();
    expect(score!.cosine_score).not.toBeNull();
    expect(score!.combined_score).toBeGreaterThan(score!.jaccard_score);
  });

  it("performs alias-aware merges before string similarity clustering", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE chunks SET content_plain = 'Simon Willison wrote this piece.' WHERE id = 1"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Willison explored this pattern again.' WHERE id = 2"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Simon Willison mentioned it once more.' WHERE id = 3"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Another Willison note for the archive.' WHERE id = 4"),
      env.DB.prepare("UPDATE chunks SET content_plain = 'Willison returned in episode two.' WHERE id = 6"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('Simon Willison', 'simon-willison', 'entity', 6)"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('willison', 'willison', 'entity', 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
      env.DB.prepare("INSERT INTO topic_dirty (topic_id, reason) VALUES (2, 'alias')"),
    ]);

    const result = await finalizeEnrichment(env.DB);
    const aliasStep = result.steps.find((step) => step.name === 'alias_merge');
    const merged = await env.DB.prepare("SELECT usage_count, hidden, display_reason FROM topics WHERE slug = 'willison'").first<{ usage_count: number; hidden: number; display_reason: string | null } | null>();
    const canonical = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'simon-willison'").first<{ usage_count: number }>();
    const archived = await env.DB.prepare("SELECT archive_reason FROM topic_lineage_archive WHERE slug = 'willison'").first<{ archive_reason: string } | null>();

    expect(aliasStep).toBeDefined();
    expect(aliasStep!.counts.topics_merged).toBeGreaterThanOrEqual(1);
    expect(merged).toBeNull();
    expect(archived).not.toBeNull();
    expect(archived!.archive_reason).toBe('zero_usage_lineage');
    expect(canonical).not.toBeNull();
    expect(canonical!.usage_count).toBeGreaterThan(0);
  });

  it("scopes merge and similarity work to dirty topics when possible", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE chunks SET content_plain = 'Dirty topic again in episode two.' WHERE id = 6"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('dirty topic', 'dirty-topic', 'concept', 6)"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('stable topic', 'stable-topic', 'concept', 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
      env.DB.prepare("INSERT INTO topic_dirty (topic_id, reason) VALUES (1, 'dirty')"),
    ]);

    const result = await finalizeEnrichment(env.DB);
    const stemStep = result.steps.find((step) => step.name === 'stem_merge');
    const diceStep = result.steps.find((step) => step.name === 'similarity_cluster');
    const dirtyRows = await env.DB.prepare("SELECT COUNT(*) as c FROM topic_dirty").first<{ c: number }>();

    expect(stemStep).toBeDefined();
    expect(diceStep).toBeDefined();
    expect(stemStep!.counts.topics_considered).toBe(1);
    expect(diceStep!.counts.topics_considered).toBe(1);
    expect(dirtyRows!.c).toBe(0);
  });

  it("keeps unchanged neighbors when an affected topic is incrementally rescored", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('alpha engine', 'alpha-engine', 'concept', 0)"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('beta lattice', 'beta-lattice', 'concept', 0)"),
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('delta harbor', 'delta-harbor', 'concept', 0)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'incremental-chunk-8', 'Chunk 8', 'Delta stands alone again in episode two.', 'Delta stands alone again in episode two.', 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 3)"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (1, '[1,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (2, '[1,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (3, '[0,1]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (4, '[0,1]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (5, '[1,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (6, '[1,0]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (7, '[0,1]')"),
      env.DB.prepare("INSERT INTO chunk_vector_cache (chunk_id, vector_json) VALUES (8, '[0,1]')"),
      env.DB.prepare("INSERT INTO topic_dirty (topic_id, reason) VALUES (1, 'dirty')"),
    ]);

    await finalizeEnrichment(env.DB);

    const beta = await env.DB.prepare("SELECT related_slugs FROM topics WHERE slug = 'beta-lattice'").first<{ related_slugs: string | null }>();
    expect(beta).not.toBeNull();
    expect(JSON.parse(beta!.related_slugs || '[]')).toContain('delta-harbor');
  });

  it("clears dirty rows even when dirty topics become ineligible before similarity refresh", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('fleeting topic', 'fleeting-topic', 'concept', 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO topic_dirty (topic_id, reason) VALUES (1, 'dirty')"),
    ]);

    await finalizeEnrichment(env.DB);

    const dirtyRows = await env.DB.prepare("SELECT COUNT(*) as c FROM topic_dirty").first<{ c: number }>();
    expect(dirtyRows!.c).toBe(0);
  });
});

describe("Phrase topics discovered before finalization", () => {
  it("creates phrase topics during enrichment and preserves them through finalization", async () => {
    // Need at least 10 chunks with repeated phrases for n-gram extraction to work
    // Insert many chunks with a common phrase appearing in multiple docs
    const phrase = "vibe coding";
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 15; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(
          i < 8 ? 1 : 2,
          `ngram-chunk-${i}`,
          `Chunk ${i}`,
          `This chunk discusses ${phrase} and deep ${phrase} models in production.`,
          `This chunk discusses ${phrase} and deep ${phrase} models in production.`,
          i < 8 ? i + 10 : i - 8
        )
      );
    }
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }

    // Phrase discovery now happens during enrichment, before finalization.
    await enrichChunks(env.DB, 1000);
    await finalizeEnrichment(env.DB);

    // Check that the discovered phrase topic was created and survived finalization.
    const phrases = await env.DB.prepare(
      "SELECT name, slug, kind FROM topics WHERE usage_count > 0"
    ).all<{ name: string; slug: string; kind: string }>();

    // The "machine learning" phrase should appear frequently enough to be extracted
    const hasPhraseTopic = phrases.results.some((t: { name: string }) => t.name.includes("vibe") && t.name.includes("coding"));
    expect(hasPhraseTopic).toBe(true);
  });

  it("backfills provenance for phrase links created during finalization", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE chunks SET analysis_text = 'vibe coding changes how teams ship', normalization_version = 1 WHERE id = 1`
      ),
      env.DB.prepare(
        `UPDATE chunks SET analysis_text = 'teams adopt vibe coding rapidly', normalization_version = 1 WHERE id = 2`
      ),
      env.DB.prepare(
        `UPDATE chunks SET analysis_text = 'vibe coding creates new workflow tradeoffs', normalization_version = 1 WHERE id = 3`
      ),
      env.DB.prepare(
        `UPDATE chunks SET analysis_text = 'good teams explore vibe coding carefully', normalization_version = 1 WHERE id = 4`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, analysis_text, normalization_version, position)
         VALUES (2, 'chunk-5', 'Chunk 5', 'Another vibe coding note.', 'Another vibe coding note.', 'another vibe coding note', 1, 0)`
      ),
      env.DB.prepare(
        `INSERT INTO phrase_lexicon (phrase, slug, support_count, doc_count, quality_score, provenance)
         VALUES ('vibe coding', 'vibe-coding', 8, 5, 12.5, 'adjacent_pmi_bigram')`
      ),
      env.DB.prepare(
        `INSERT INTO topics (name, slug, kind, usage_count, provenance_complete)
         VALUES ('vibe coding', 'vibe-coding', 'phrase', 0, 0)`
      ),
    ]);

    await finalizeEnrichment(env.DB);

    const audit = await env.DB.prepare(
      `SELECT stage, decision, source
       FROM topic_candidate_audit
       WHERE slug = 'vibe-coding' AND chunk_id = 1`
    ).first<{ stage: string; decision: string; source: string }>();
    expect(audit).not.toBeNull();
    expect(audit?.stage).toBe("phrase_backfill");
    expect(audit?.decision).toBe("accepted");
    expect(audit?.source).toBe("phrase_lexicon");

    const topic = await env.DB.prepare(
      "SELECT usage_count, provenance_complete FROM topics WHERE slug = 'vibe-coding'"
    ).first<{ usage_count: number; provenance_complete: number }>();
    expect(topic?.usage_count).toBeGreaterThan(0);
    expect(topic?.provenance_complete).toBe(1);
  });
});

describe("Zero-usage lineage archiving", () => {
  it("archives zero-usage lineage topics and removes them from live topics", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO topics (id, name, slug, kind, usage_count, display_reason, provenance_complete) VALUES (90, 'lineage phrase', 'lineage-phrase', 'phrase', 0, 'canonicalized_duplicate', 1)"
      ),
      env.DB.prepare(
        `INSERT INTO topic_candidate_audit (
           chunk_id, topic_id, source, stage, raw_candidate, normalized_candidate,
           topic_name, slug, score, kind, decision, decision_reason, provenance
         ) VALUES (1, 90, 'phrase_lexicon', 'topic_inserted', 'lineage phrase', 'lineage phrase', 'lineage phrase', 'lineage-phrase', 1.0, 'phrase', 'accepted', 'candidate_survived_filters', '[]')`
      ),
    ]);

    const result = await finalizeEnrichment(env.DB);

    expect(result.archived_lineage_topics).toBeGreaterThanOrEqual(1);

    const liveTopic = await env.DB.prepare(
      "SELECT id FROM topics WHERE id = 90"
    ).first();
    expect(liveTopic).toBeNull();

    const archived = await env.DB.prepare(
      "SELECT original_topic_id, archive_reason FROM topic_lineage_archive WHERE original_topic_id = 90"
    ).first<{ original_topic_id: number; archive_reason: string }>();
    expect(archived).not.toBeNull();
    expect(archived?.archive_reason).toBe("zero_usage_lineage");
  });

  it("compacts repeated lineage archives by slug and increments archive_count", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO topic_lineage_archive (
           original_topic_id, name, slug, kind, usage_count, distinctiveness,
           provenance_complete, archive_reason, archive_count, last_original_topic_id, last_archived_at
         ) VALUES (100, 'lineage phrase', 'lineage-phrase', 'phrase', 0, 0, 1, 'zero_usage_lineage', 1, 100, datetime('now'))`
      ),
      env.DB.prepare(
        `INSERT INTO topics (id, name, slug, kind, usage_count, display_reason, provenance_complete)
         VALUES (101, 'lineage phrase', 'lineage-phrase', 'phrase', 0, 'canonicalized_duplicate', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO topic_candidate_audit (
           chunk_id, topic_id, source, stage, raw_candidate, normalized_candidate,
           topic_name, slug, score, kind, decision, decision_reason, provenance
         ) VALUES (1, 101, 'phrase_lexicon', 'topic_inserted', 'lineage phrase', 'lineage phrase', 'lineage phrase', 'lineage-phrase', 1.0, 'phrase', 'accepted', 'candidate_survived_filters', '[]')`
      ),
    ]);

    await finalizeEnrichment(env.DB);

    const archiveRow = await env.DB.prepare(
      "SELECT archive_count, last_original_topic_id FROM topic_lineage_archive WHERE slug = 'lineage-phrase'"
    ).first<{ archive_count: number; last_original_topic_id: number }>();
    expect(archiveRow).not.toBeNull();
    expect(archiveRow?.archive_count).toBe(2);
    expect(archiveRow?.last_original_topic_id).toBe(101);
  });
});
