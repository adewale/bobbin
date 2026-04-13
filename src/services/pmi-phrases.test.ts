/**
 * Tests for PMI-based phrase extraction from chunk_words table.
 *
 * PMI (Pointwise Mutual Information) measures how much more two words
 * co-occur than expected by chance. High PMI = genuine collocation.
 *
 * Seed data:
 * - "vibe" in 5 chunks, "coding" in 6 chunks, both in 4 chunks = high PMI
 * - "higher" in 100 chunks, "quality" in 150 chunks, both in 80 chunks = low PMI
 * - Total chunks: 200
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { extractPMIPhrases } from "./pmi-phrases";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-01-test', 'Ep 1', '2025-01-01', 2025, 1, 1, 200)"
  ).run();

  // Create 200 chunks
  for (let batch = 0; batch < 4; batch++) {
    const stmts: D1PreparedStatement[] = [];
    for (let i = batch * 50; i < (batch + 1) * 50; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count, enriched) VALUES (1, ?, ?, 'x', 'x', ?, 10, 1)"
        ).bind(`chunk-${i}`, `Chunk ${i}`, i)
      );
    }
    await env.DB.batch(stmts);
  }

  // Seed chunk_words for "vibe" and "coding" (rare words, high co-occurrence relative to individual frequency)
  // "vibe" in chunks 1-5 (5 chunks), "coding" in chunks 1-6 (6 chunks), both in chunks 1-4 (4 chunks)
  const vibeStmts: D1PreparedStatement[] = [];
  for (let i = 1; i <= 5; i++) {
    vibeStmts.push(
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (?, 'vibe', 2)").bind(i)
    );
  }
  for (let i = 1; i <= 4; i++) {
    // "coding" overlaps with "vibe" on chunks 1-4
    vibeStmts.push(
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (?, 'coding', 3)").bind(i)
    );
  }
  // "coding" also in chunks 7 and 8 (no overlap with "vibe")
  vibeStmts.push(
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (7, 'coding', 3)")
  );
  vibeStmts.push(
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (8, 'coding', 3)")
  );
  await env.DB.batch(vibeStmts);

  // Seed chunk_words for "higher" and "quality" (common words, low PMI)
  // "higher" in chunks 10-109 (100 chunks), "quality" in chunks 10-159 (150 chunks)
  // both co-occur in chunks 10-89 (80 chunks)
  for (let batch = 0; batch < 3; batch++) {
    const stmts: D1PreparedStatement[] = [];
    const start = batch * 50;
    const end = Math.min((batch + 1) * 50, 100);
    for (let i = start; i < end; i++) {
      stmts.push(
        env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (?, 'higher', 1)").bind(i + 11)
      );
    }
    if (stmts.length > 0) await env.DB.batch(stmts);
  }
  for (let batch = 0; batch < 3; batch++) {
    const stmts: D1PreparedStatement[] = [];
    const start = batch * 50;
    const end = Math.min((batch + 1) * 50, 150);
    for (let i = start; i < end; i++) {
      stmts.push(
        env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (?, 'quality', 1)").bind(i + 11)
      );
    }
    if (stmts.length > 0) await env.DB.batch(stmts);
  }
});

describe("extractPMIPhrases", () => {
  it("finds 'coding vibe' (rare words that co-occur) with high PMI", async () => {
    const phrases = await extractPMIPhrases(env.DB, 3.0, 3, 100);
    // "coding" < "vibe" alphabetically, so the phrase is "coding vibe"
    const found = phrases.find(p => p.phrase === "coding vibe");
    expect(found).toBeDefined();
    expect(found!.pmi).toBeGreaterThan(3.0);
    expect(found!.coDocCount).toBe(4);
  });

  it("does NOT find 'higher quality' (common words) — low PMI", async () => {
    const phrases = await extractPMIPhrases(env.DB, 3.0, 3, 100);
    const found = phrases.find(p => p.phrase === "higher quality");
    // "higher quality" should either not appear or have PMI below threshold
    expect(found).toBeUndefined();
  });

  it("respects minCooccurrence threshold", async () => {
    // With minCooccurrence = 5, "coding vibe" (co_doc_count=4) should be excluded
    const phrases = await extractPMIPhrases(env.DB, 0, 5, 100);
    const found = phrases.find(p => p.phrase === "coding vibe");
    expect(found).toBeUndefined();
  });

  it("returns empty for corpus with no significant collocations", async () => {
    // Create a fresh DB with only isolated words (no co-occurrences)
    await env.DB.prepare("DELETE FROM chunk_words").run();

    // Each word appears in exactly one chunk — no co-occurrences possible
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'alpha', 1)"),
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'beta', 1)"),
      env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (3, 'gamma', 1)"),
    ]);

    const phrases = await extractPMIPhrases(env.DB, 3.0, 2, 100);
    expect(phrases).toHaveLength(0);
  });
});
