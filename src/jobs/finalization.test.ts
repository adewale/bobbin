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
    // Add a concept topic with df≥5 so it survives the quality gate
    // Entity validation should NOT remove its chunk_topics (only entities are validated)
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('ecosystem', 'ecosystem', 'concept', 5)").run();
    // Need 5 chunk_topics links for it to survive df≥5 gate
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-5', 'C5', 'Eco chunk.', 'Eco chunk.', 4)"
    ).run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
    ]);

    await finalizeEnrichment(env.DB);

    const conceptRemaining = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 2").first<{ c: number }>();
    expect(conceptRemaining!.c).toBe(5); // all preserved — concepts aren't validated
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
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-5', 'C5', 'Popular topic here.', 'Popular topic here.', 4)"
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
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('atlas', 'atlas', 'concept', 0)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('zephyr', 'zephyr', 'concept', 0)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('quartz', 'quartz', 'concept', 0)").run();

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
         VALUES (1, 'chunk-5', 'Chunk 5', 'Another vibe coding note.', 'Another vibe coding note.', 'another vibe coding note', 1, 4)`
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
