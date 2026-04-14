/**
 * Tests for kind-safety: only authoritative sources set kind.
 * Regression tests for the 2,968 false entity bug.
 *
 * Written AFTER the fix (should have been before).
 * These prevent the bug from recurring.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { enrichChunks, processChunkBatch } from "./ingest";
import { extractTopics, extractEntities, extractKnownEntities } from "../services/topic-extractor";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')").run();
  await env.DB.prepare(
    "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 3)"
  ).run();
});

describe("Only curated known entities get kind='entity'", () => {
  it("extractEntities (heuristic) returns no kind on results", () => {
    const results = extractEntities(
      "The team at Fascinating Corp built something. Sweeping changes followed. Previously this was impossible."
    );
    for (const r of results) {
      // Heuristic entities must NOT have kind='entity'
      expect(r.kind).not.toBe("entity");
    }
  });

  it("extractKnownEntities returns kind='entity' for curated entities", () => {
    const results = extractKnownEntities("OpenAI and Google compete in AI.");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.kind).toBe("entity");
    }
  });

  it("extractTopics only has kind='entity' for curated known entities", () => {
    // Text with both curated entities and heuristic-detected capitalised words
    const text = "OpenAI released ChatGPT. The Fascinating architecture uses Sweeping optimizations. Google also competes.";
    const topics = extractTopics(text);

    for (const t of topics) {
      if (t.kind === "entity") {
        // This must be a curated entity, not a heuristic detection
        const knownNames = ["openai", "chatgpt", "google"];
        expect(knownNames).toContain(t.name.toLowerCase());
      }
    }
  });
});

describe("enrichChunks does not create false entity topics", () => {
  it("after enrichment, only curated entities have kind='entity'", async () => {
    // Seed chunks with capitalised words that are NOT entities
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1', 'C1', 'Fascinating research on ecosystem dynamics.', 'Fascinating research on ecosystem dynamics.', 0)"
      ),
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c2', 'C2', 'The team at OpenAI released something. Sweeping changes in the industry.', 'The team at OpenAI released something. Sweeping changes in the industry.', 1)"
      ),
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c3', 'C3', 'Previously impossible things are now possible with Google and Anthropic.', 'Previously impossible things are now possible with Google and Anthropic.', 2)"
      ),
    ]);

    await enrichChunks(env.DB, 100);

    // Check all entity-kind topics
    const entities = await env.DB.prepare(
      "SELECT name, slug FROM topics WHERE kind = 'entity'"
    ).all<{ name: string; slug: string }>();

    const entityNames = entities.results.map(e => e.name.toLowerCase());

    // Only curated known entities should have kind='entity'
    // "fascinating", "sweeping", "previously" must NOT be entities
    expect(entityNames).not.toContain("fascinating");
    expect(entityNames).not.toContain("sweeping");
    expect(entityNames).not.toContain("previously");

    // Curated entities SHOULD be present
    // (OpenAI, Google, Anthropic are in the known-entities list)
    expect(entityNames.some(n => n === "openai" || n === "OpenAI")).toBe(true);
  });
});

describe("processChunkBatch is the single source of truth", () => {
  it("enrichChunks and processChunkBatch produce the same result", async () => {
    // Seed identical chunks in two episodes
    await env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-02-06', 'Ep 2', '2025-02-06', 2025, 2, 6, 1)"
    ).run();

    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'via-enrich', 'Test', 'The ecosystem evolves through resonant computing and LLM architectures.', 'The ecosystem evolves through resonant computing and LLM architectures.', 0)"
    ).run();

    // Process via enrichChunks
    await enrichChunks(env.DB, 100);

    const enrichResult = await env.DB.prepare(
      "SELECT t.name FROM chunk_topics ct JOIN topics t ON ct.topic_id = t.id WHERE ct.chunk_id = (SELECT id FROM chunks WHERE slug = 'via-enrich') ORDER BY t.name"
    ).all<{ name: string }>();

    // Now process an identical chunk via processChunkBatch directly
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'via-process', 'Test', 'The ecosystem evolves through resonant computing and LLM architectures.', 'The ecosystem evolves through resonant computing and LLM architectures.', 0)"
    ).run();

    const chunk = await env.DB.prepare(
      "SELECT id, episode_id, content_plain FROM chunks WHERE slug = 'via-process'"
    ).first<{ id: number; episode_id: number; content_plain: string }>();

    await processChunkBatch(env.DB, [chunk!]);

    const processResult = await env.DB.prepare(
      "SELECT t.name FROM chunk_topics ct JOIN topics t ON ct.topic_id = t.id WHERE ct.chunk_id = ? ORDER BY t.name"
    ).bind(chunk!.id).all<{ name: string }>();

    // Both paths should produce the same topics
    const enrichNames = enrichResult.results.map(r => r.name);
    const processNames = processResult.results.map(r => r.name);
    expect(enrichNames).toEqual(processNames);
  });
});
