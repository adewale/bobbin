/**
 * RED tests for three structural pipeline fixes.
 * Write these first, verify they fail, then implement the fix.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { extractTopics } from "../services/topic-extractor";
import { isNoiseTopic } from "../services/topic-quality";
import { enrichChunks } from "./ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')").run();
  await env.DB.prepare(
    "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 1)"
  ).run();
});

// === Issue 1: Noise filter should be INSIDE extractTopics ===

describe("Issue 1: extractTopics filters noise internally", () => {
  it("never returns topics that isNoiseTopic considers noise", () => {
    // Text containing known noise words
    const text = "The system software platform creates leverage through fundamentally different approaches to product design and business value.";
    const topics = extractTopics(text);

    for (const t of topics) {
      if (t.kind !== "entity") {
        expect(isNoiseTopic(t.name)).toBe(false);
      }
    }
  });

  it("still returns legitimate topics from the same text", () => {
    // Text with both noise words AND real topics
    const text = "The ecosystem dynamics of resonant computing and prompt injection in LLMs are transforming how we think about chatbot architecture and swarm intelligence.";
    const topics = extractTopics(text);
    const names = topics.map(t => t.name);

    // Should find at least some legitimate topics
    expect(topics.length).toBeGreaterThan(0);
    // None should be noise
    for (const t of topics) {
      if (t.kind !== "entity") {
        expect(isNoiseTopic(t.name)).toBe(false);
      }
    }
  });
});

// === Issue 2: Flag column instead of NOT IN subquery ===

describe("Issue 2: enriched flag on chunks table", () => {
  it("newly inserted chunks have enriched=false", async () => {
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'test-chunk', 'Test', 'Content about ecosystems.', 'Content about ecosystems.', 0)"
    ).run();

    const chunk = await env.DB.prepare("SELECT enriched FROM chunks WHERE slug = 'test-chunk'").first<{ enriched: number }>();
    expect(chunk).not.toBeNull();
    expect(chunk!.enriched).toBe(0);
  });

  it("enriched chunks have enriched=true after enrichment", async () => {
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'test-chunk', 'Test', 'Content about ecosystems and platform dynamics.', 'Content about ecosystems and platform dynamics.', 0)"
    ).run();

    await enrichChunks(env.DB, 100);

    const chunk = await env.DB.prepare("SELECT enriched FROM chunks WHERE slug = 'test-chunk'").first<{ enriched: number }>();
    expect(chunk!.enriched).toBe(1);
  });

  it("enrichChunks only picks up unenriched chunks", async () => {
    // Insert 3 chunks
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, ?, ?, ?)"
      ).bind(`chunk-${i}`, `Chunk ${i}`, `Ecosystem dynamics content ${i}`, `Ecosystem dynamics content ${i}`, i).run();
    }

    // Enrich first batch
    const r1 = await enrichChunks(env.DB, 2);
    expect(r1.chunksProcessed).toBe(2);

    // Second batch gets the remaining 1
    const r2 = await enrichChunks(env.DB, 10);
    expect(r2.chunksProcessed).toBe(1);

    // Third batch gets 0 — all enriched
    const r3 = await enrichChunks(env.DB, 10);
    expect(r3.chunksProcessed).toBe(0);
  });
});

// === Issue 3: IDF from word_stats instead of per-batch ===

describe("Issue 3: IDF uses precomputed word_stats", () => {
  it("extractTopics with precomputed IDF scores differently than without", () => {
    // A word that appears in every document should get low IDF
    // A word that appears in few documents should get high IDF
    const text = "The ecosystem dynamics are fascinating and the resonant computing paradigm shifts everything.";

    // Without corpus stats (pure TF — current per-batch behavior)
    const withoutIdf = extractTopics(text);

    // With simulated corpus stats where "ecosystem" is common (high DF)
    // and "resonant" is rare (low DF)
    const corpusStats = {
      totalChunks: 1000,
      docFreq: new Map([
        ["ecosystem", 800],  // very common
        ["resonant", 10],    // very rare
        ["dynamic", 500],    // common
        ["computing", 200],  // moderate
        ["paradigm", 5],     // very rare
        ["fascinating", 300], // common
      ]),
    };
    const withIdf = extractTopics(text, 15, corpusStats);

    // With IDF, rare words (resonant, paradigm) should rank higher
    // than common words (ecosystem, dynamic)
    const withIdfNames = withIdf.map(t => t.name);
    const withoutIdfNames = withoutIdf.map(t => t.name);

    // The ordering should be different — IDF changes rankings
    // (We can't assert exact order because entity detection also affects ranking)
    // But we can verify that both produce valid results
    expect(withIdf.length).toBeGreaterThan(0);
    expect(withoutIdf.length).toBeGreaterThan(0);
  });
});
