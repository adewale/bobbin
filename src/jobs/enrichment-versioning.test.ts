/**
 * Tests for enrichment versioning (Item 6 from pipeline-v3 spec).
 *
 * When CURRENT_ENRICHMENT_VERSION is bumped, previously enriched chunks
 * are picked up again by getUnenrichedChunks and re-enriched.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { getUnenrichedChunks, markChunksEnriched } from "../db/ingestion";
import { CURRENT_ENRICHMENT_VERSION } from "./ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-01-test', 'Ep 1', '2025-01-01', 2025, 1, 1, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count) VALUES (1, 'chunk-1', 'Chunk 1', 'Alpha beta gamma.', 'Alpha beta gamma.', 0, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count) VALUES (1, 'chunk-2', 'Chunk 2', 'Delta epsilon zeta.', 'Delta epsilon zeta.', 1, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count) VALUES (1, 'chunk-3', 'Chunk 3', 'Eta theta iota.', 'Eta theta iota.', 2, 3)"
    ),
  ]);
});

describe("Enrichment versioning", () => {
  it("chunks with enrichment_version < CURRENT are picked up by getUnenrichedChunks", async () => {
    // Mark chunks as enriched with an old version (version 0)
    await env.DB.prepare(
      "UPDATE chunks SET enriched = 1, enrichment_version = 0 WHERE id IN (1, 2, 3)"
    ).run();

    // getUnenrichedChunks should find them because enrichment_version < CURRENT
    const unenriched = await getUnenrichedChunks(env.DB, 100);
    expect(unenriched.length).toBe(3);
    expect(unenriched.map((c: any) => c.id).sort()).toEqual([1, 2, 3]);
  });

  it("after enrichment, chunks have enrichment_version = CURRENT", async () => {
    // Mark chunks as enriched using the function
    await markChunksEnriched(env.DB, [1, 2, 3]);

    // Check that enrichment_version matches CURRENT_ENRICHMENT_VERSION
    const chunks = await env.DB.prepare(
      "SELECT id, enrichment_version FROM chunks WHERE id IN (1, 2, 3)"
    ).all<{ id: number; enrichment_version: number }>();

    for (const chunk of chunks.results) {
      expect(chunk.enrichment_version).toBe(CURRENT_ENRICHMENT_VERSION);
    }
  });

  it("bumping CURRENT_ENRICHMENT_VERSION causes previously enriched chunks to be re-enriched", async () => {
    // Simulate chunks enriched at version (CURRENT - 1)
    const oldVersion = CURRENT_ENRICHMENT_VERSION - 1;
    await env.DB.prepare(
      `UPDATE chunks SET enriched = 1, enrichment_version = ? WHERE id IN (1, 2, 3)`
    ).bind(oldVersion).run();

    // getUnenrichedChunks should pick them up (version is outdated)
    const unenriched = await getUnenrichedChunks(env.DB, 100);
    expect(unenriched.length).toBe(3);

    // After marking enriched again, they should have the current version
    await markChunksEnriched(env.DB, [1, 2, 3]);

    const chunks = await env.DB.prepare(
      "SELECT id, enrichment_version FROM chunks WHERE id IN (1, 2, 3)"
    ).all<{ id: number; enrichment_version: number }>();

    for (const chunk of chunks.results) {
      expect(chunk.enrichment_version).toBe(CURRENT_ENRICHMENT_VERSION);
    }

    // Now getUnenrichedChunks should NOT find them
    const unenriched2 = await getUnenrichedChunks(env.DB, 100);
    expect(unenriched2.length).toBe(0);
  });

  it("fully unenriched chunks (enriched=0) are always picked up regardless of version", async () => {
    // Chunks start with enriched=0, enrichment_version=0 by default
    const unenriched = await getUnenrichedChunks(env.DB, 100);
    expect(unenriched.length).toBe(3);
  });

  it("returns outdated chunks newest-first for deterministic batch processing", async () => {
    await env.DB.prepare(
      "UPDATE chunks SET enriched = 1, enrichment_version = 0 WHERE id IN (1, 2, 3)"
    ).run();

    const unenriched = await getUnenrichedChunks(env.DB, 100);
    expect(unenriched.map((chunk: { id: number }) => chunk.id)).toEqual([3, 2, 1]);
  });

  it("markChunksEnriched sets both enriched flag and current version", async () => {
    await markChunksEnriched(env.DB, [1, 3]);

    const chunks = await env.DB.prepare(
      "SELECT id, enriched, enrichment_version FROM chunks WHERE id IN (1, 2, 3) ORDER BY id"
    ).all<{ id: number; enriched: number; enrichment_version: number }>();

    expect(chunks.results).toEqual([
      { id: 1, enriched: 1, enrichment_version: CURRENT_ENRICHMENT_VERSION },
      { id: 2, enriched: 0, enrichment_version: 0 },
      { id: 3, enriched: 1, enrichment_version: CURRENT_ENRICHMENT_VERSION },
    ]);
  });
});
