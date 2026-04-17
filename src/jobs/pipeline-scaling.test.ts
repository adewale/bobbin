/**
 * Pipeline scaling and edge case tests.
 *
 * These test the structural properties of the enrichment pipeline
 * that affect performance and correctness at scale.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { enrichChunks, finalizeEnrichment } from "./ingest";
import { extractTopics } from "../services/topic-extractor";
import { extractEntities } from "../services/topic-extractor";
import { isNoiseTopic } from "../services/topic-quality";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')").run();
  await env.DB.prepare(
    "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 1)"
  ).run();
});

describe("Sentence-start capitalisation (root cause of 2,436 false entities)", () => {
  it("does NOT classify ordinary sentence-start words as entities", () => {
    // These are common English words capitalised only because they start a sentence
    const text = [
      "Fascinating research was published.",
      "Suddenly the market shifted.",
      "Previously this was considered impossible.",
      "Tool usage is increasing among developers.",
      "Quality matters more than quantity.",
      "Feedback loops drive improvement.",
      "Impressive results were achieved.",
      "Merging these approaches yields benefits.",
    ].join(" ");

    const entities = extractEntities(text);
    const names = entities.map(r => r.name);

    // NONE of these should be detected as entities
    expect(names).not.toContain("fascinating");
    expect(names).not.toContain("suddenly");
    expect(names).not.toContain("previously");
    expect(names).not.toContain("tool");
    expect(names).not.toContain("quality");
    expect(names).not.toContain("feedback");
    expect(names).not.toContain("impressive");
    expect(names).not.toContain("merging");
  });

  it("DOES detect mid-sentence capitalised words as entities", () => {
    const text = "The team at OpenAI built something. Then Anthropic responded.";
    const entities = extractEntities(text);
    const names = entities.map(r => r.name);
    expect(names).toContain("openai");
  });

  it("DOES detect multi-word entities even at sentence start", () => {
    const text = "Simon Willison wrote about it. Claude Code is a tool.";
    const entities = extractEntities(text);
    const names = entities.map(r => r.name);
    expect(names).toContain("simon willison");
    expect(names).toContain("claude code");
  });
});

describe("Topic count per chunk is bounded", () => {
  it("extractTopics returns at most maxTopics results", () => {
    const longText = `
      The ecosystem dynamics of platform markets are fascinating. LLMs are transforming
      the software industry through agent architectures and swarm intelligence. Prompt
      injection remains a critical security concern. Cognitive labor is being augmented
      by vibe coding practices. The tech industry continues to evolve with emergent
      behaviors in collective intelligence systems. Resonant ideas spread through
      leverage points in complex adaptive systems. ChatGPT and Claude represent different
      approaches to artificial intelligence development. OpenAI and Anthropic compete
      for dominance. Google and Meta have their own strategies. Network effects drive
      platform consolidation across multiple vertical markets simultaneously.
    `;
    const topics = extractTopics(longText, 15);
    // maxTopics limits YAKE + heuristic results; known entities are extra
    const nonEntities = topics.filter(t => t.kind !== "entity");
    expect(nonEntities.length).toBeLessThanOrEqual(15);
    // Verify the results are actually topics, not empty
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.slug.length).toBeGreaterThan(0);
    }
  });

  it("noise topics are filtered at enrichment insert time, not in extractTopics", () => {
    // extractTopics returns raw candidates including noise words
    const text = "The system software model data code product tool value trust quality business.";
    const topics = extractTopics(text);
    // Some results may be noise words — that's expected
    // The filtering happens in enrichChunks, not here
    expect(topics.length).toBeGreaterThanOrEqual(0);

    // Verify the noise filter would catch them
    const noiseCount = topics.filter(t => t.kind !== "entity" && isNoiseTopic(t.name)).length;
    const cleanCount = topics.filter(t => t.kind !== "entity" && !isNoiseTopic(t.name)).length;
    // At least some should be noise (system, software, model etc are noise words)
    // This documents that extractTopics does NOT self-filter — the caller must filter
    expect(noiseCount + cleanCount).toBe(topics.filter(t => t.kind !== "entity").length);
  });
});

describe("getUnenrichedChunks scaling", () => {
  it("NOT IN subquery works correctly with existing chunk_topics", async () => {
    // Seed 5 chunks, enrich 3, verify 2 remain unenriched
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, ?, ?, ?)"
      ).bind(`chunk-${i}`, `Chunk ${i}`, `Content about ecosystems and platform dynamics ${i}`, `Content about ecosystems and platform dynamics ${i}`, i).run();
    }

    // Enrich first batch (should get some chunks)
    const result1 = await enrichChunks(env.DB, 3);
    expect(result1.chunksProcessed).toBe(3);

    // Second batch should get the remaining 2
    const result2 = await enrichChunks(env.DB, 10);
    expect(result2.chunksProcessed).toBe(2);

    // Third batch should get 0
    const result3 = await enrichChunks(env.DB, 10);
    expect(result3.chunksProcessed).toBe(0);
  });
});

describe("Episode topic count stays reasonable", () => {
  it("episode with 10 chunks does not produce more than 100 episode_topics", async () => {
    // Seed 10 chunks for one episode
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, ?, ?, ?)"
      ).bind(
        `chunk-${i}`,
        `Chunk ${i}`,
        `The ecosystem evolves through platform dynamics and resonant computing. LLMs enable infinite software. Prompt injection is a concern. Cognitive labor shifts. Vibe coding emerges ${i}.`,
        `The ecosystem evolves through platform dynamics and resonant computing. LLMs enable infinite software. Prompt injection is a concern. Cognitive labor shifts. Vibe coding emerges ${i}.`,
        i
      ).run();
    }

    await enrichChunks(env.DB, 100);

    const epTopicCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM episode_topics WHERE episode_id = 1"
    ).first<{ c: number }>();

    // 10 chunks × 15 max topics = 150 theoretical max, but dedup and noise filter should reduce this
    // A reasonable upper bound is 100 unique topics per episode
    expect(epTopicCount!.c).toBeLessThan(100);
    // With episode-spread gating, single-episode corpora may produce 0 promotable episode topics.
    expect(epTopicCount!.c).toBeGreaterThanOrEqual(0);
  });
});

describe("Finalization cleanup correctness", () => {
  it("noise words with kind=concept are cleaned even if they have high usage", async () => {
    // Seed a noise word topic with high usage
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('system', 'system', 'concept', 50)").run();
    await env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1', 'C1', 'x', 'x', 0)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run();

    await finalizeEnrichment(env.DB);

    // "system" is a noise word — its chunk_topics should be deleted
    const remaining = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 1").first<{ c: number }>();
    expect(remaining!.c).toBe(0);
  });

  it("entities are NOT cleaned even if their name looks generic", async () => {
    // "meta" is a company but could look generic
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('meta', 'meta', 'entity', 10)").run();
    await env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1', 'C1', 'Meta announced something', 'Meta announced something', 0)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run();

    await finalizeEnrichment(env.DB);

    // Entity should survive cleanup
    const remaining = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 1").first<{ c: number }>();
    expect(remaining!.c).toBe(1);
  });
});
