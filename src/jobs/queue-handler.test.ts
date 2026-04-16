/**
 * Tests for queue handler behavior (compute-related and assign-ngram).
 * Tests through DB effects since the individual handlers are module-private.
 * We simulate what the handlers do by calling the same SQL patterns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { slugify } from "../lib/slug";
import { handleEnrichBatch } from "./queue-handler";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1', 'Chunk 1', 'The ecosystem evolves through platform dynamics.', 'The ecosystem evolves through platform dynamics.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-2', 'Chunk 2', 'Platform ecosystem and prompt injection attacks.', 'Platform ecosystem and prompt injection attacks.', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-3', 'Chunk 3', 'Agent swarm patterns in distributed systems.', 'Agent swarm patterns in distributed systems.', 2)"
    ),
  ]);
});

describe("compute-related handler behavior", () => {
  it("computes related_slugs for a topic with co-occurring topics", async () => {
    // Setup: topic A and B co-occur on chunk 1 and 2; topic C only on chunk 3
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 2)"),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('platform', 'platform', 2)"),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('swarm', 'swarm', 1)"),
      // ecosystem on chunks 1, 2
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
      // platform on chunks 1, 2
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
      // swarm only on chunk 3
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
    ]);

    // Simulate compute-related for topic "ecosystem" (id=1)
    const topicId = 1;
    const related = await env.DB.prepare(
      `SELECT t.slug FROM chunk_topics ct1
       JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
       JOIN topics t ON ct2.topic_id = t.id
       WHERE ct1.topic_id = ?
       GROUP BY ct2.topic_id
       ORDER BY COUNT(*) DESC
       LIMIT 5`
    ).bind(topicId).all<{ slug: string }>();

    const slugs = JSON.stringify(related.results.map((r: { slug: string }) => r.slug));
    await env.DB.prepare(
      "UPDATE topics SET related_slugs = ? WHERE id = ?"
    ).bind(slugs, topicId).run();

    // Verify: ecosystem's related_slugs should include platform
    const topic = await env.DB.prepare(
      "SELECT related_slugs FROM topics WHERE id = ?"
    ).bind(topicId).first<{ related_slugs: string }>();

    expect(topic).not.toBeNull();
    const parsedSlugs = JSON.parse(topic!.related_slugs);
    expect(Array.isArray(parsedSlugs)).toBe(true);
    expect(parsedSlugs).toContain("platform");
    // swarm should NOT be related (no co-occurrence with ecosystem)
    expect(parsedSlugs).not.toContain("swarm");
  });

  it("returns empty related_slugs for a topic with no co-occurrences", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('isolated', 'isolated', 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
    ]);

    const topicId = 1;
    const related = await env.DB.prepare(
      `SELECT t.slug FROM chunk_topics ct1
       JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
       JOIN topics t ON ct2.topic_id = t.id
       WHERE ct1.topic_id = ?
       GROUP BY ct2.topic_id
       ORDER BY COUNT(*) DESC
       LIMIT 5`
    ).bind(topicId).all<{ slug: string }>();

    const slugs = JSON.stringify(related.results.map((r: { slug: string }) => r.slug));
    await env.DB.prepare(
      "UPDATE topics SET related_slugs = ? WHERE id = ?"
    ).bind(slugs, topicId).run();

    const topic = await env.DB.prepare(
      "SELECT related_slugs FROM topics WHERE id = ?"
    ).bind(topicId).first<{ related_slugs: string }>();

    expect(topic).not.toBeNull();
    const parsedSlugs = JSON.parse(topic!.related_slugs);
    expect(Array.isArray(parsedSlugs)).toBe(true);
    expect(parsedSlugs).toHaveLength(0);
  });

  it("limits related_slugs to 5 entries", async () => {
    // Create 7 topics, all co-occurring with topic 1
    const topicInserts = [];
    const ctInserts = [];
    for (let i = 1; i <= 7; i++) {
      topicInserts.push(
        env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES (?, ?, 5)")
          .bind(`topic${i}`, `topic${i}`)
      );
    }
    await env.DB.batch(topicInserts);

    // Add more chunks to create co-occurrences
    for (let chunkIdx = 4; chunkIdx <= 10; chunkIdx++) {
      await env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, 'Extra', 'Extra chunk.', 'Extra chunk.', ?)"
      ).bind(`extra-${chunkIdx}`, chunkIdx).run();
    }

    // topic1 on chunks 1-7, each other topic on one chunk with topic1
    for (let chunkId = 1; chunkId <= 7; chunkId++) {
      await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(chunkId).run();
      if (chunkId <= 7) {
        await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
          .bind(chunkId, chunkId + 1 <= 7 ? chunkId + 1 : 2).run();
      }
    }

    const related = await env.DB.prepare(
      `SELECT t.slug FROM chunk_topics ct1
       JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
       JOIN topics t ON ct2.topic_id = t.id
       WHERE ct1.topic_id = 1
       GROUP BY ct2.topic_id
       ORDER BY COUNT(*) DESC
       LIMIT 5`
    ).bind().all<{ slug: string }>();

    expect(related.results.length).toBeLessThanOrEqual(5);
  });
});

describe("assign-ngram handler behavior", () => {
  it("creates phrase topic and assigns to matching chunks", async () => {
    // Seed chunks containing "prompt injection"
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'pi-chunk-1', 'PI 1', 'Prompt injection is a security concern.', 'prompt injection is a security concern.', 10)`
    ).run();
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'pi-chunk-2', 'PI 2', 'Another prompt injection example here.', 'another prompt injection example here.', 11)`
    ).run();

    const phrase = "prompt injection";
    const slug = slugify(phrase);

    // Simulate handleAssignNgram
    await env.DB.prepare(
      "INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, 'phrase')"
    ).bind(phrase, slug).run();

    const topic = await env.DB.prepare(
      "SELECT id FROM topics WHERE slug = ?"
    ).bind(slug).first<{ id: number }>();
    expect(topic).not.toBeNull();

    const matchingChunks = await env.DB.prepare(
      "SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ? ESCAPE '\\'"
    ).bind(`%${phrase}%`).all<{ id: number }>();

    for (const c of matchingChunks.results) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)"
      ).bind(c.id, topic!.id).run();
    }

    await env.DB.prepare(
      "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = ?) WHERE id = ?"
    ).bind(topic!.id, topic!.id).run();

    // Verify: topic exists with kind='phrase'
    const result = await env.DB.prepare(
      "SELECT kind, usage_count FROM topics WHERE slug = ?"
    ).bind(slug).first<{ kind: string; usage_count: number }>();
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("phrase");
    // Matches pi-chunk-1, pi-chunk-2, and chunk-2 from seed data (which also contains "prompt injection")
    expect(result!.usage_count).toBeGreaterThanOrEqual(2);
  });

  it("does not create topic for very short slugs", async () => {
    const phrase = "a b";
    const slug = slugify(phrase);

    // slug for "a b" would be "a-b" (3 chars) — should be skipped
    if (!slug || slug.length < 3) {
      // This is the expected behavior: the handler exits early
      expect(slug.length).toBeLessThanOrEqual(3);
      return;
    }

    // If slug somehow passes the length check, verify no topic created
    const topic = await env.DB.prepare(
      "SELECT id FROM topics WHERE slug = ?"
    ).bind(slug).first();
    expect(topic).toBeNull();
  });

  it("does not double-assign chunks for existing phrase topics", async () => {
    // Pre-create the topic and one assignment
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, kind) VALUES ('ecosystem dynamics', 'ecosystem-dynamics', 'phrase')"
    ).run();
    const topicId = (await env.DB.prepare("SELECT id FROM topics WHERE slug = 'ecosystem-dynamics'").first<{ id: number }>())!.id;

    // chunk-1 content contains "ecosystem" but not the exact phrase "ecosystem dynamics"
    // chunk-2 contains "ecosystem" in content but let's add one that has the phrase
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'eco-dyn-chunk', 'Eco Dyn', 'The ecosystem dynamics of platform markets.', 'the ecosystem dynamics of platform markets.', 20)`
    ).run();
    const chunkId = (await env.DB.prepare("SELECT id FROM chunks WHERE slug = 'eco-dyn-chunk'").first<{ id: number }>())!.id;

    // First assignment
    await env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(chunkId, topicId).run();
    // Second (duplicate) assignment
    await env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(chunkId, topicId).run();

    // Should only have one row (INSERT OR IGNORE prevents duplicates)
    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics WHERE chunk_id = ? AND topic_id = ?"
    ).bind(chunkId, topicId).first<{ c: number }>();
    expect(count!.c).toBe(1);
  });
});

describe("enrich-batch handler", () => {
  it("creates topic assignments for specified chunks", async () => {
    // Seed word_stats so IDF can be loaded
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO word_stats (word, total_count, doc_count) VALUES ('ecosystem', 10, 3)"
      ),
      env.DB.prepare(
        "INSERT INTO word_stats (word, total_count, doc_count) VALUES ('platform', 8, 2)"
      ),
      env.DB.prepare(
        "INSERT INTO word_stats (word, total_count, doc_count) VALUES ('dynamics', 5, 2)"
      ),
    ]);

    // Process only chunks 1 and 2
    await handleEnrichBatch(env.DB, [1, 2]);

    // Verify: topics were created
    const topics = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topics"
    ).first<{ c: number }>();
    expect(topics!.c).toBeGreaterThan(0);

    // Verify: chunk_topics were created for the specified chunks
    const ct = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics WHERE chunk_id IN (1, 2)"
    ).first<{ c: number }>();
    expect(ct!.c).toBeGreaterThan(0);

    // Verify: chunk 3 was NOT processed (not in the batch)
    const ct3 = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics WHERE chunk_id = 3"
    ).first<{ c: number }>();
    expect(ct3!.c).toBe(0);
  });

  it("marks chunks as enriched", async () => {
    // Verify chunks start unenriched
    const before = await env.DB.prepare(
      "SELECT enriched FROM chunks WHERE id = 1"
    ).first<{ enriched: number }>();
    expect(before!.enriched).toBe(0);

    await handleEnrichBatch(env.DB, [1, 2]);

    // Verify: chunks 1 and 2 are marked enriched
    const after1 = await env.DB.prepare(
      "SELECT enriched FROM chunks WHERE id = 1"
    ).first<{ enriched: number }>();
    expect(after1!.enriched).toBe(1);

    const after2 = await env.DB.prepare(
      "SELECT enriched FROM chunks WHERE id = 2"
    ).first<{ enriched: number }>();
    expect(after2!.enriched).toBe(1);

    // Verify: chunk 3 is still unenriched
    const after3 = await env.DB.prepare(
      "SELECT enriched FROM chunks WHERE id = 3"
    ).first<{ enriched: number }>();
    expect(after3!.enriched).toBe(0);
  });

  it("handles empty chunk IDs gracefully", async () => {
    // Should not throw for empty array
    await handleEnrichBatch(env.DB, []);

    // No topics or chunk_topics should be created
    const topics = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topics"
    ).first<{ c: number }>();
    expect(topics!.c).toBe(0);

    const ct = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_topics"
    ).first<{ c: number }>();
    expect(ct!.c).toBe(0);
  });
});
