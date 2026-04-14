/**
 * RED tests for version bump and orphan cleanup gaps.
 *
 * These test the specific production failures found on 2026-04-14:
 * 1. YAKE never ran because CURRENT_ENRICHMENT_VERSION wasn't bumped
 * 2. 378K orphan topic rows accumulated across enrichment versions
 * 3. phrase_dedup self-join on 378K rows exceeded D1 CPU limit
 * 4. HTML entities leaking through to topic names
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { CURRENT_ENRICHMENT_VERSION, finalizeEnrichment } from "./ingest";
import { batchExec } from "../lib/db";
import fc from "fast-check";
import { extractYakeKeywords } from "../services/yake";
import { extractTopics, normalizeTerm } from "../services/topic-extractor";

describe("enrichment version", () => {
  it("CURRENT_ENRICHMENT_VERSION is >= 4 (YAKE migration)", () => {
    // YAKE replaced TF-IDF — version must be bumped to force re-enrichment
    expect(CURRENT_ENRICHMENT_VERSION).toBeGreaterThanOrEqual(4);
  });
});

describe("topic name data migration", () => {
  beforeEach(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')").run();
    await env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 5)"
    ).run();
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 5; i++) {
      stmts.push(env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, 'x', 'x', ?)"
      ).bind(`c-${i}`, `C ${i}`, i));
    }
    await batchExec(env.DB, stmts);
  });

  it("fixes topic names with dangling apostrophes (actual production bug)", async () => {
    // Production has names like "someone else'" — apostrophe char, not HTML entity
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('someone else''', 'someone-else', 10)"
    ).run();
    for (let i = 1; i <= 5; i++) {
      await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(i).run();
    }

    await finalizeEnrichment(env.DB);

    const topic = await env.DB.prepare(
      "SELECT name FROM topics WHERE usage_count > 0 AND name LIKE 'someone%'"
    ).first<{ name: string }>();
    expect(topic).not.toBeNull();
    expect(topic!.name).not.toContain("'");
    expect(topic!.name).toBe("someone else");
  });

  it("fixes goodhart' law → goodhart law (apostrophe mid-name)", async () => {
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('goodhart'' law', 'goodhart-law', 10)"
    ).run();
    for (let i = 1; i <= 5; i++) {
      await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(i).run();
    }

    await finalizeEnrichment(env.DB);

    const topic = await env.DB.prepare(
      "SELECT name FROM topics WHERE usage_count > 0 AND name LIKE 'goodhart%'"
    ).first<{ name: string }>();
    expect(topic).not.toBeNull();
    expect(topic!.name).toBe("goodhart law");
  });

  it("also fixes HTML entity &#39; if present", async () => {
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('test&#39;name', 'test-name', 10)"
    ).run();
    for (let i = 1; i <= 5; i++) {
      await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(i).run();
    }

    await finalizeEnrichment(env.DB);

    const topic = await env.DB.prepare(
      "SELECT name FROM topics WHERE usage_count > 0 AND name LIKE 'test%'"
    ).first<{ name: string }>();
    expect(topic).not.toBeNull();
    expect(topic!.name).not.toContain("&#");
    expect(topic!.name).not.toContain("'");
  });
});

describe("orphan topic cleanup in finalization", () => {
  beforeEach(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')").run();
    await env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 5)"
    ).run();
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 5; i++) {
      stmts.push(env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, 'x', 'x', ?)"
      ).bind(`chunk-${i}`, `Chunk ${i}`, i));
    }
    await batchExec(env.DB, stmts);
  });

  it("finalization removes orphan topics (no chunk_topics links)", async () => {
    // Simulate accumulated orphans from old enrichment versions
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('orphan1', 'orphan1', 0)"),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('orphan2', 'orphan2', 0)"),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('active', 'active', 5)"),
    ]);
    // Only 'active' has chunk_topics
    for (let i = 1; i <= 5; i++) {
      await env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 3)").bind(i).run();
    }

    await finalizeEnrichment(env.DB);

    // Orphan topics (no chunk_topics) should be deleted from the table
    const orphans = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topics WHERE slug IN ('orphan1', 'orphan2')"
    ).first<{ c: number }>();
    expect(orphans!.c).toBe(0); // actually deleted, not just usage=0
  });

  it("phrase_dedup only considers active topics (not orphans)", async () => {
    // Seed many orphan topics — phrase_dedup should skip them
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 100; i++) {
      stmts.push(env.DB.prepare(
        "INSERT INTO topics (name, slug, usage_count) VALUES (?, ?, 0)"
      ).bind(`orphan-${i}`, `orphan-${i}`));
    }
    await batchExec(env.DB, stmts);

    // This should complete quickly — not trying to self-join 100 orphans
    const result = await finalizeEnrichment(env.DB);
    const dedupStep = result.steps.find(s => s.name === "phrase_dedup");
    expect(dedupStep).toBeDefined();
    expect(dedupStep!.status).toBe("ok");
  });
});

describe("HTML entity and possessive handling in topic names", () => {
  it("topic names never contain HTML entities", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "Goodhart's law", "O'Reilly's book", "it's complicated",
          "McKeown\u2019s Essentialism", "the researcher's model"
        ),
        (text) => {
          const topics = extractTopics(text + " and something else entirely different.", 5);
          for (const t of topics) {
            expect(t.name).not.toContain("&#");
            expect(t.name).not.toContain("&amp;");
            expect(t.name).not.toContain("&lt;");
            expect(t.name).not.toContain("&gt;");
            expect(t.name).not.toContain("&#39;");
          }
        }
      )
    );
  });

  it("topic names never end with a dangling apostrophe", () => {
    const texts = [
      "someone else's problem to solve. This is someone else's concern.",
      "Goodhart's law applies here. Goodhart's law is well known.",
      "the company's strategy works. The company's approach is bold.",
    ];
    for (const text of texts) {
      const topics = extractTopics(text, 5);
      for (const t of topics) {
        expect(t.name).not.toMatch(/[''\u2019]$/);
        expect(t.name).not.toMatch(/[''\u2019]\s/);
      }
    }
  });

  it("normalizeTerm strips possessives cleanly", () => {
    expect(normalizeTerm("else's")).not.toContain("'");
    expect(normalizeTerm("goodhart's")).not.toContain("'");
    expect(normalizeTerm("mckeown\u2019s")).not.toContain("\u2019");
  });
});

describe("YAKE PBT properties", () => {
  it("YAKE never produces more keywords than requested", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 20, maxLength: 500 }),
        fc.integer({ min: 1, max: 20 }),
        (text, n) => {
          const keywords = extractYakeKeywords(text, n);
          expect(keywords.length).toBeLessThanOrEqual(n);
        }
      )
    );
  });

  it("YAKE keywords are always non-empty strings with positive scores", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 30, maxLength: 500 }),
        (text) => {
          const keywords = extractYakeKeywords(text, 5);
          for (const kw of keywords) {
            expect(kw.keyword.length).toBeGreaterThan(0);
            expect(kw.score).toBeGreaterThan(0);
            expect(Number.isFinite(kw.score)).toBe(true);
          }
        }
      )
    );
  });

  it("YAKE is deterministic", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 30, maxLength: 300 }),
        (text) => {
          const run1 = extractYakeKeywords(text, 5);
          const run2 = extractYakeKeywords(text, 5);
          expect(run1).toEqual(run2);
        }
      )
    );
  });
});
