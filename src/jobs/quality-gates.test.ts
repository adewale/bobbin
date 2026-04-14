/**
 * Tests for the corpus-wide quality gates in finalization.
 * Written RED-first to verify each gate actually works on realistic data.
 *
 * These tests seed data that mimics what YAKE extraction produces:
 * stem variants, near-duplicates, and low-df topics that should be pruned.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { finalizeEnrichment } from "./ingest";
import { batchExec } from "../lib/db";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')").run();
  await env.DB.prepare(
    "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 10)"
  ).run();

  // Insert 10 chunks
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < 10; i++) {
    stmts.push(env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, enriched, enrichment_version) VALUES (1, ?, ?, 'x', 'x', ?, 1, 4)"
    ).bind(`chunk-${i}`, `Chunk ${i}`, i));
  }
  await batchExec(env.DB, stmts);
});

describe("df≥5 quality gate", () => {
  it("prunes topics with fewer than 5 chunk associations", async () => {
    // Topic A: df=3 (below threshold)
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('rare topic', 'rare-topic', 3)").run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
    ]);

    // Topic B: df=6 (above threshold)
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('common topic', 'common-topic', 6)").run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
    ]);

    await finalizeEnrichment(env.DB);

    const rare = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'rare-topic'").first<any>();
    // Pruned — either usage=0 or deleted by orphan cleanup
    expect(!rare || rare.usage_count === 0).toBe(true);

    const common = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'common-topic'").first<any>();
    expect(common.usage_count).toBeGreaterThanOrEqual(5); // survived
  });

  it("entities are exempt from df threshold", async () => {
    // Entity with df=2 should survive (entities exempt)
    // Update chunks to contain the entity name so entity validation passes
    await env.DB.prepare("UPDATE chunks SET content_plain = 'OpenAI releases models' WHERE id IN (1, 2)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('OpenAI', 'openai', 'entity', 2)").run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
    ]);

    await finalizeEnrichment(env.DB);

    const entity = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'openai'").first<any>();
    expect(entity.usage_count).toBe(2); // preserved despite df<5
  });
});

describe("stem merge", () => {
  it("merges stem-equivalent topics (aggregate + aggregated → keep higher usage)", async () => {
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('aggregate', 'aggregate', 7)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('aggregated', 'aggregated', 5)").run();

    // Give both enough chunk_topics to survive df≥5
    const stmts: D1PreparedStatement[] = [];
    for (let i = 1; i <= 7; i++) {
      stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(i));
    }
    for (let i = 1; i <= 5; i++) {
      stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 2)").bind(i));
    }
    await batchExec(env.DB, stmts);

    await finalizeEnrichment(env.DB);

    // "aggregate" (higher usage) should absorb "aggregated"
    const aggregate = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'aggregate'").first<any>();
    const aggregated = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'aggregated'").first<any>();

    expect(aggregate.usage_count).toBeGreaterThan(0); // survived
    // Merged away — either usage=0 or deleted by orphan cleanup
    expect(!aggregated || aggregated.usage_count === 0).toBe(true);
  });

  it("merges build + building → keep build", async () => {
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('build', 'build', 8)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('building', 'building', 6)").run();

    const stmts: D1PreparedStatement[] = [];
    for (let i = 1; i <= 8; i++) stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(i));
    for (let i = 1; i <= 6; i++) stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 2)").bind(i));
    await batchExec(env.DB, stmts);

    await finalizeEnrichment(env.DB);

    const build = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'build'").first<any>();
    const building = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'building'").first<any>();

    expect(build.usage_count).toBeGreaterThan(0);
    expect(!building || building.usage_count === 0).toBe(true);
  });
});

describe("similarity clustering", () => {
  it("merges near-duplicate multi-word topics", async () => {
    // "consumer ai" and "consumer ai goes" have Dice > 0.7
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('consumer ai', 'consumer-ai', 8)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('consumer ai goes', 'consumer-ai-goes', 5)").run();

    const stmts: D1PreparedStatement[] = [];
    for (let i = 1; i <= 8; i++) stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(i));
    for (let i = 1; i <= 5; i++) stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 2)").bind(i));
    await batchExec(env.DB, stmts);

    await finalizeEnrichment(env.DB);

    const consumerAi = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'consumer-ai'").first<any>();
    const consumerAiGoes = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'consumer-ai-goes'").first<any>();

    // Longer phrase is the representative, shorter merges into it
    // OR shorter absorbs longer — either way one should be 0
    // One should be merged away (deleted or usage=0)
    const oneIsMerged = !consumerAi || consumerAi.usage_count === 0 ||
                        !consumerAiGoes || consumerAiGoes.usage_count === 0;
    expect(oneIsMerged).toBe(true);
  });

  it("does NOT merge genuinely different topics", async () => {
    // Use words that are NOT in NOISE_WORDS
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('transformer', 'transformer', 7)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('chatbot', 'chatbot', 6)").run();

    const stmts: D1PreparedStatement[] = [];
    for (let i = 1; i <= 7; i++) stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(i));
    for (let i = 1; i <= 6; i++) stmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 2)").bind(i));
    await batchExec(env.DB, stmts);

    await finalizeEnrichment(env.DB);

    const t1 = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'transformer'").first<any>();
    const t2 = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'chatbot'").first<any>();

    expect(t1.usage_count).toBeGreaterThan(0);
    expect(t2.usage_count).toBeGreaterThan(0); // both survive — genuinely different
  });
});

describe("full pipeline: extract → finalize produces reasonable topic count", () => {
  it("10 chunks produce fewer than 50 active topics after all quality gates", async () => {
    // Update chunks to have real content that YAKE can extract from
    const texts = [
      "Consumer AI is being absorbed by platforms. Enterprise AI converges around a few vendors.",
      "Vertical AI carves out domain-specific value. The APIs become commodities quickly.",
      "Meta just acquired both Gizmo and Dreamer for personal software products.",
      "The transformer architecture enables large language models to reason effectively.",
      "LLMs use attention mechanisms for better token prediction across sequences.",
      "Agents coordinate through swarms and the ecosystem evolves rapidly over time.",
      "OpenAI released ChatGPT and Google responded with Gemini very soon after.",
      "Prompt injection remains a critical security concern for deployed systems.",
      "Cognitive labor is being augmented by new coding practices and tools.",
      "The tech industry continues to evolve with new patterns emerging constantly.",
    ];
    const updateStmts = texts.map((text, i) =>
      env.DB.prepare("UPDATE chunks SET content_plain = ?, enriched = 0, enrichment_version = 0 WHERE id = ?")
        .bind(text, i + 1)
    );
    await batchExec(env.DB, updateStmts);

    // Run enrichment
    const { enrichChunks } = await import("./ingest");
    await enrichChunks(env.DB, 100);
    await finalizeEnrichment(env.DB);

    const activeTopics = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topics WHERE usage_count > 0"
    ).first<{ c: number }>();

    // With 10 chunks and df≥5 gate, very few topics should survive
    // (most YAKE keyphrases are unique to 1-2 chunks)
    expect(activeTopics!.c).toBeLessThan(50);

    // But entities should still be present
    const entities = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topics WHERE kind = 'entity' AND usage_count > 0"
    ).first<{ c: number }>();
    expect(entities!.c).toBeGreaterThan(0);
  });
});
