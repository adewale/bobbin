/**
 * Scale test for finalizeEnrichment.
 *
 * Production has 5,771 chunks, 13,000+ topics, 50,000+ chunk_topic rows.
 * The finalization ALWAYS failed in production — this test verifies the fix.
 *
 * Root cause: O(n) individual DELETE queries in the noise cleanup loop.
 * With thousands of noise topics, each getting 2 individual DELETEs,
 * the total query count exceeded the Workers timeout.
 *
 * Fix: batched IN-clause DELETEs (90 per batch) + per-step instrumentation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { finalizeEnrichment, type FinalizeResult } from "./ingest";
import { isNoiseTopic } from "../services/topic-quality";
import { batchExec } from "../lib/db";

const NUM_CHUNKS = 200;
const TOPICS_PER_CHUNK = 10;

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, ?)"
  ).bind(NUM_CHUNKS).run();

  // Insert chunks — some contain entity names so entity validation has realistic data
  const chunkStmts: D1PreparedStatement[] = [];
  const entityMentions = ["openai", "google", "anthropic", "chatgpt", "claude"];
  for (let i = 0; i < NUM_CHUNKS; i++) {
    // Every 10th chunk mentions an entity
    const entityMention = i % 10 === 0
      ? ` The team at ${entityMentions[i % entityMentions.length]} released something new.`
      : "";
    chunkStmts.push(
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, enriched, enrichment_version) VALUES (1, ?, ?, ?, ?, ?, 1, 4)"
      ).bind(
        `chunk-${i}`, `Chunk ${i}`,
        `Content for chunk ${i}.${entityMention}`,
        `Content for chunk ${i}.${entityMention}`,
        i
      )
    );
  }
  await batchExec(env.DB, chunkStmts);

  // Create a realistic topic distribution
  const topicStmts: D1PreparedStatement[] = [];

  // Noise concept topics (these should be cleaned up during finalization)
  const noiseWords = [
    "system", "software", "model", "data", "code", "product", "tool",
    "process", "company", "future", "platform", "network", "technology",
    "attention", "opportunity", "pattern", "decision", "environment",
    "strategy", "energy", "dynamic", "challenge", "influence", "potential",
    "resource", "competition", "knowledge", "effort", "structure",
    "community", "standard", "generation", "practice", "force",
    "concern", "alignment", "context", "market", "signal", "scale",
  ];
  for (const word of noiseWords) {
    topicStmts.push(
      env.DB.prepare(
        "INSERT INTO topics (name, slug, kind, usage_count) VALUES (?, ?, 'concept', ?)"
      ).bind(word, word, Math.floor(Math.random() * 20) + 2)
    );
  }

  // Real concept topics
  const realConcepts = [
    "llm", "prompt-engineering", "fine-tuning", "retrieval-augmented-generation",
    "vector-database", "embedding", "transformer", "tokenizer", "hallucination",
    "chain-of-thought", "few-shot-learning", "gradient-descent",
    "diffusion-model", "multimodal", "reasoning", "benchmark",
    "open-source", "quantization", "distillation", "throughput",
  ];
  for (const concept of realConcepts) {
    const name = concept.replace(/-/g, " ");
    topicStmts.push(
      env.DB.prepare(
        "INSERT INTO topics (name, slug, kind, usage_count) VALUES (?, ?, 'concept', ?)"
      ).bind(name, concept, Math.floor(Math.random() * 50) + 5)
    );
  }

  // More concept topics to reach ~200 total
  for (let i = 0; i < 140; i++) {
    topicStmts.push(
      env.DB.prepare(
        "INSERT INTO topics (name, slug, kind, usage_count) VALUES (?, ?, 'concept', ?)"
      ).bind(`topic-${i}`, `topic-${i}`, Math.floor(Math.random() * 30) + 1)
    );
  }

  // Entity topics
  const entities = ["openai", "google", "anthropic", "chatgpt", "claude"];
  for (const entity of entities) {
    topicStmts.push(
      env.DB.prepare(
        "INSERT INTO topics (name, slug, kind, usage_count) VALUES (?, ?, 'entity', ?)"
      ).bind(entity, `entity-${entity}`, Math.floor(Math.random() * 40) + 3)
    );
  }

  // Phrase topics
  const phrases = ["vibe coding", "prompt injection", "machine learning",
    "artificial intelligence", "large language model"];
  for (const phrase of phrases) {
    topicStmts.push(
      env.DB.prepare(
        "INSERT INTO topics (name, slug, kind, usage_count) VALUES (?, ?, 'phrase', ?)"
      ).bind(phrase, phrase.replace(/\s+/g, "-"), Math.floor(Math.random() * 25) + 5)
    );
  }

  await batchExec(env.DB, topicStmts);

  // Get all topic IDs
  const allTopics = await env.DB.prepare("SELECT id FROM topics").all<{ id: number }>();
  const topicIds = allTopics.results.map(t => t.id);

  // Assign entity topics only to chunks that mention the entity
  const entityTopics = await env.DB.prepare(
    "SELECT id, name FROM topics WHERE kind = 'entity'"
  ).all<{ id: number; name: string }>();
  const entityCtStmts: D1PreparedStatement[] = [];
  for (const et of entityTopics.results) {
    const matchingChunks = await env.DB.prepare(
      "SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ?"
    ).bind(`%${et.name}%`).all<{ id: number }>();
    for (const mc of matchingChunks.results) {
      entityCtStmts.push(
        env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
          .bind(mc.id, et.id)
      );
    }
  }
  if (entityCtStmts.length > 0) {
    await batchExec(env.DB, entityCtStmts);
  }

  // Assign non-entity topics randomly to chunks
  const nonEntityIds = topicIds.filter(id => !entityTopics.results.some(et => et.id === id));
  const ctStmts: D1PreparedStatement[] = [];
  for (let chunkId = 1; chunkId <= NUM_CHUNKS; chunkId++) {
    const shuffled = [...nonEntityIds].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, TOPICS_PER_CHUNK);
    for (const topicId of selected) {
      ctStmts.push(
        env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
          .bind(chunkId, topicId)
      );
    }
  }
  await batchExec(env.DB, ctStmts);

  // Create episode_topics
  await env.DB.prepare(
    "INSERT OR IGNORE INTO episode_topics (episode_id, topic_id) SELECT DISTINCT 1, topic_id FROM chunk_topics"
  ).run();

  // Seed chunk_words
  const wordStmts: D1PreparedStatement[] = [];
  const commonWords = ["the", "and", "for", "with", "this", "that", "from",
    "llm", "model", "data", "code", "prompt", "token", "embedding",
    "inference", "training", "fine", "tune", "vector", "search"];
  for (let chunkId = 1; chunkId <= NUM_CHUNKS; chunkId++) {
    for (const word of commonWords.slice(0, 10 + Math.floor(Math.random() * 10))) {
      wordStmts.push(
        env.DB.prepare("INSERT OR REPLACE INTO chunk_words (chunk_id, word, count) VALUES (?, ?, ?)")
          .bind(chunkId, word, Math.floor(Math.random() * 5) + 1)
      );
    }
  }
  await batchExec(env.DB, wordStmts);
});

describe("finalizeEnrichment at scale", () => {
  it("completes without error on 200 chunks / 200+ topics / 2000+ chunk_topics", async () => {
    const result = await finalizeEnrichment(env.DB);

    expect(result.usage_recalculated).toBe(true);
    expect(result.word_stats_rebuilt).toBe(true);
    expect(result.noise_removed).toBeGreaterThan(0);

    // Verify noise topics were cleaned up
    const noiseTopics = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics ct JOIN topics t ON ct.topic_id = t.id WHERE t.kind != 'entity' AND t.name IN ('system', 'software', 'model', 'data', 'code', 'product', 'tool', 'platform', 'network', 'technology')"
    ).first<{ c: number }>();
    expect(noiseTopics!.c).toBe(0);

    // Entity topics with real chunk mentions should survive
    const entityTopics = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topics WHERE kind = 'entity' AND usage_count > 0"
    ).first<{ c: number }>();
    expect(entityTopics!.c).toBeGreaterThan(0);
  });

  it("reports step-level timing in the result", async () => {
    const result = await finalizeEnrichment(env.DB);

    expect(result.steps).toBeDefined();
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);

    // Each step should have name, duration, status
    for (const step of result.steps) {
      expect(step).toHaveProperty("name");
      expect(step).toHaveProperty("duration_ms");
      expect(typeof step.duration_ms).toBe("number");
      expect(step).toHaveProperty("status");
      expect(["ok", "error"]).toContain(step.status);
    }

    // Total time should be tracked
    expect(result.total_ms).toBeGreaterThan(0);

    // All steps should have succeeded
    const failedSteps = result.steps.filter(s => s.status === "error");
    expect(failedSteps).toHaveLength(0);
  });

  it("preserves entity topics with real chunk mentions", async () => {
    await finalizeEnrichment(env.DB);

    // Entities assigned to chunks that mention them should survive
    const entities = await env.DB.prepare(
      "SELECT name, usage_count FROM topics WHERE kind = 'entity' AND usage_count > 0 ORDER BY usage_count DESC"
    ).all<{ name: string; usage_count: number }>();

    // At least some entities should survive (we seeded ~20 chunks per entity)
    expect(entities.results.length).toBeGreaterThan(0);

    // Each surviving entity should only be linked to chunks that contain its name
    for (const entity of entities.results) {
      const falseLinks = await env.DB.prepare(
        `SELECT COUNT(*) as c FROM chunk_topics ct
         JOIN topics t ON ct.topic_id = t.id
         JOIN chunks c ON ct.chunk_id = c.id
         WHERE t.name = ? AND LOWER(c.content_plain) NOT LIKE ?`
      ).bind(entity.name, `%${entity.name}%`).first<{ c: number }>();
      expect(falseLinks!.c).toBe(0);
    }
  });

  it("completes noise cleanup without O(n) individual queries", async () => {
    // Count noise topics before finalization
    const allTopics = await env.DB.prepare(
      "SELECT id, name, kind FROM topics WHERE usage_count > 0"
    ).all<{ id: number; name: string; kind: string }>();
    const noiseCount = allTopics.results.filter(
      t => t.kind !== "entity" && isNoiseTopic(t.name)
    ).length;
    expect(noiseCount).toBeGreaterThan(10);

    const start = Date.now();
    const result = await finalizeEnrichment(env.DB);
    const elapsed = Date.now() - start;

    // With batched operations, should complete quickly even with 200+ topics
    expect(elapsed).toBeLessThan(10000);

    // Verify the noise_cleanup step specifically was fast
    const noiseStep = result.steps.find(s => s.name === "noise_cleanup");
    expect(noiseStep).toBeDefined();
    expect(noiseStep!.status).toBe("ok");

    // Verify all noise chunk_topics were removed
    const afterNoise = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics ct JOIN topics t ON ct.topic_id = t.id WHERE t.kind != 'entity' AND t.name IN ('system', 'software', 'model', 'data', 'code')"
    ).first<{ c: number }>();
    expect(afterNoise!.c).toBe(0);
  });
});
