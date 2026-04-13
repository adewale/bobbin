/**
 * Tests for entity kind assignment and noise filtering during enrichment.
 * Covers:
 * - Entity kind is set correctly during enrichChunks (P0)
 * - Noise topics are filtered at INSERT time (P0)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { enrichChunks, finalizeEnrichment } from "./ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 3)"
    ),
  ]);
});

describe("Entity kind is set correctly during enrichment", () => {
  it("known entities get kind='entity' after enrichChunks", async () => {
    // Seed a chunk that mentions a known entity (OpenAI is in KNOWN_ENTITIES)
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'entity-test-1', 'Entity Test',
         'OpenAI released a new model that changes the landscape of artificial intelligence.',
         'OpenAI released a new model that changes the landscape of artificial intelligence.', 0)`
    ).run();

    await enrichChunks(env.DB, 100);

    const topic = await env.DB.prepare(
      "SELECT kind, name FROM topics WHERE slug = 'openai'"
    ).first<{ kind: string; name: string }>();

    expect(topic).not.toBeNull();
    expect(topic!.kind).toBe("entity");
    expect(topic!.name).toBe("OpenAI");
  });

  it("Google is detected as entity from chunk text", async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'entity-test-google', 'Google Test',
         'Google announced new features for Gemini that compete with other large language models.',
         'Google announced new features for Gemini that compete with other large language models.', 0)`
    ).run();

    await enrichChunks(env.DB, 100);

    const googleTopic = await env.DB.prepare(
      "SELECT kind FROM topics WHERE slug = 'google'"
    ).first<{ kind: string }>();
    expect(googleTopic).not.toBeNull();
    expect(googleTopic!.kind).toBe("entity");

    const geminiTopic = await env.DB.prepare(
      "SELECT kind FROM topics WHERE slug = 'gemini'"
    ).first<{ kind: string }>();
    expect(geminiTopic).not.toBeNull();
    expect(geminiTopic!.kind).toBe("entity");
  });

  it("non-entity topics get kind='concept' by default", async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'concept-test', 'Concept Test',
         'The ecosystem dynamics of platform markets are fascinating and often counterintuitive.',
         'The ecosystem dynamics of platform markets are fascinating and often counterintuitive.', 0)`
    ).run();

    await enrichChunks(env.DB, 100);

    // Get topics that are concepts (not entities)
    const concepts = await env.DB.prepare(
      "SELECT name, kind FROM topics WHERE kind = 'concept'"
    ).all();

    // Should have at least some concept topics
    expect(concepts.results.length).toBeGreaterThan(0);
    for (const t of concepts.results as any[]) {
      expect(t.kind).toBe("concept");
      // concept topics should not be company/product names
      expect(["openai", "google", "anthropic", "meta"]).not.toContain(t.name.toLowerCase());
    }
  });

  it("entity kind is preserved when topic already exists as concept", async () => {
    // Pre-create the topic as a concept
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, kind) VALUES ('OpenAI', 'openai', 'concept')"
    ).run();

    // Now enrich a chunk that detects it as an entity
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'entity-upgrade', 'Entity Upgrade',
         'OpenAI continues to push the boundaries of large language model research.',
         'OpenAI continues to push the boundaries of large language model research.', 0)`
    ).run();

    await enrichChunks(env.DB, 100);

    const topic = await env.DB.prepare(
      "SELECT kind FROM topics WHERE slug = 'openai'"
    ).first<{ kind: string }>();
    expect(topic).not.toBeNull();
    expect(topic!.kind).toBe("entity");
  });
});

describe("Noise topics filtered at INSERT time", () => {
  it("chunks do not get noise-word topics assigned", async () => {
    // Seed a chunk that contains noise words like "system" and "software"
    // but also contains a legitimate topic like "ecosystem"
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'test-noise', 'Noise Test',
         'The system and software are designed for the ecosystem dynamics of the platform.',
         'The system and software are designed for the ecosystem dynamics of the platform.', 10)`
    ).run();

    await enrichChunks(env.DB, 100);

    const chunkId = await env.DB.prepare(
      "SELECT id FROM chunks WHERE slug = 'test-noise'"
    ).first<{ id: number }>();

    // "system" and "software" should NOT be in chunk_topics (noise filtered at insert time)
    const noiseTopics = await env.DB.prepare(
      `SELECT t.name FROM chunk_topics ct
       JOIN topics t ON ct.topic_id = t.id
       WHERE ct.chunk_id = ?
       AND t.name IN ('system', 'software')`,
    ).bind(chunkId!.id).all();
    expect(noiseTopics.results.length).toBe(0);
  });

  it("legitimate topics from the same chunk survive noise filtering", async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'test-mixed', 'Mixed Test',
         'The system software drives the ecosystem dynamics and platform architecture evolution.',
         'The system software drives the ecosystem dynamics and platform architecture evolution.', 11)`
    ).run();

    await enrichChunks(env.DB, 100);

    const chunkId = await env.DB.prepare(
      "SELECT id FROM chunks WHERE slug = 'test-mixed'"
    ).first<{ id: number }>();

    // Check that at least one non-noise topic was assigned
    const goodTopics = await env.DB.prepare(
      `SELECT t.name FROM chunk_topics ct
       JOIN topics t ON ct.topic_id = t.id
       WHERE ct.chunk_id = ?`,
    ).bind(chunkId!.id).all();

    // Should have at least one topic assigned (e.g., "ecosystem", "platform", "architecture")
    expect(goodTopics.results.length).toBeGreaterThan(0);

    // None of the assigned topics should be noise words
    const noiseWords = new Set(["system", "software", "model", "data", "code", "product", "tool"]);
    for (const t of goodTopics.results as any[]) {
      expect(noiseWords.has(t.name)).toBe(false);
    }
  });

  it("entities bypass noise filtering even if the word looks generic", async () => {
    // "Meta" is a known entity, but "meta" as a lowercase word could look generic
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'test-entity-noise', 'Entity Noise Test',
         'Meta announced new features for their AI assistant platform.',
         'Meta announced new features for their AI assistant platform.', 12)`
    ).run();

    await enrichChunks(env.DB, 100);

    // Meta should still be detected as an entity (entities bypass noise filtering)
    const metaTopic = await env.DB.prepare(
      "SELECT kind FROM topics WHERE slug = 'meta'"
    ).first<{ kind: string }>();
    expect(metaTopic).not.toBeNull();
    expect(metaTopic!.kind).toBe("entity");
  });
});
