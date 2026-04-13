/**
 * Tests for self-healing finalization steps.
 * Each step runs automatically during finalizeEnrichment and fixes data quality issues.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { finalizeEnrichment, enrichChunks, enrichAllChunks } from "./ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 3)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1', 'Chunk 1', 'The ecosystem evolves through platform dynamics and network effects.', 'The ecosystem evolves through platform dynamics and network effects.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-2', 'Chunk 2', 'Geoffrey Litt writes about malleable software and end-user programming.', 'Geoffrey Litt writes about malleable software and end-user programming.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-3', 'Chunk 3', 'Little things add up over time into something big.', 'Little things add up over time into something big.', 2)"),
  ]);
});

describe("Issue 1: Entity validation removes false matches", () => {
  it("deletes chunk_topics where chunk doesn't contain entity name", async () => {
    // Add another chunk that mentions Geoffrey Litt (so usage > 1 after validation)
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-4', 'Chunk 4', 'Geoffrey Litt also presented at the conference.', 'Geoffrey Litt also presented at the conference.', 3)"
    ).run();

    // "geoffrey litt" topic assigned to chunk-2 (correct), chunk-3 (false: "Little"), chunk-4 (correct)
    await env.DB.prepare("INSERT INTO topics (name, slug, kind, usage_count) VALUES ('geoffrey litt', 'geoffrey-litt', 'entity', 3)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)").run(); // correct
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)").run(); // false match
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)").run(); // correct

    await finalizeEnrichment(env.DB);

    // False match (chunk-3) should be removed, 2 correct remain
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 1"
    ).first<{ c: number }>();
    expect(remaining!.c).toBe(2);
  });
});

describe("Issue 3: Prune usage=1 topics", () => {
  it("deletes topics with usage_count <= 1 after finalization", async () => {
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('rare-word', 'rare-word', 1)").run();
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('common', 'common', 5)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run();
    for (let i = 1; i <= 5; i++) {
      await env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, 2)").bind(Math.min(i, 3)).run();
    }

    await finalizeEnrichment(env.DB);

    const rare = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'rare-word'").first();
    // After prune, rare-word should be deleted or have usage=0
    if (rare) {
      expect(rare.usage_count).toBe(0);
    }
    const common = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'common'").first();
    expect(common).not.toBeNull();
  });
});

describe("Issue 4: enrichAllChunks processes all chunks within budget", () => {
  it("enriches all chunks by looping internally", async () => {
    const total = await enrichAllChunks(env.DB, 10, 15000); // batch=10, 15s budget
    expect(total).toBeGreaterThanOrEqual(3); // at least 3 chunks enriched

    const unenriched = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE id NOT IN (SELECT DISTINCT chunk_id FROM chunk_topics)"
    ).first<{ c: number }>();
    // Most chunks enriched (some very short chunks may produce no topics)
    expect(unenriched!.c).toBeLessThanOrEqual(1);
  });
});

describe("Issue 5: Noise-word topics cleaned up", () => {
  it("removes chunk_topics for noise-word topics during finalization", async () => {
    // "system" is in NOISE_WORDS
    await env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('system', 'system', 3)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)").run();
    await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)").run();

    await finalizeEnrichment(env.DB);

    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics WHERE topic_id = 1"
    ).first<{ c: number }>();
    expect(remaining!.c).toBe(0);
  });
});
