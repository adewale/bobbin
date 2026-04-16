import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { enrichChunks } from "./ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-06', 'Ep 1', '2025-01-06', 2025, 1, 6, 2)"
    ),
  ]);
});

describe("chunk-local pipeline artifacts", () => {
  it("persists normalization, phrase lexicon, and candidate audit before topic fan-out", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'chunk-1', 'Chunk 1', 'The system software team keeps talking about vibe coding.', 'The system software team keeps talking about vibe coding.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'chunk-2', 'Chunk 2', 'Vibe coding changes how teams ship software.', 'Vibe coding changes how teams ship software.', 1)`
      ),
    ]);

    await enrichChunks(env.DB, 100);

    const normalizedChunk = await env.DB.prepare(
      "SELECT analysis_text, normalization_version FROM chunks WHERE slug = 'chunk-1'"
    ).first<{ analysis_text: string; normalization_version: number }>();
    expect(normalizedChunk).not.toBeNull();
    expect(normalizedChunk!.analysis_text).toContain("vibe coding");
    expect(normalizedChunk!.normalization_version).toBeGreaterThan(0);

    const phrase = await env.DB.prepare(
      "SELECT phrase, doc_count, quality_score FROM phrase_lexicon WHERE slug = 'vibe-coding'"
    ).first<{ phrase: string; doc_count: number; quality_score: number }>();
    expect(phrase).not.toBeNull();
    expect(phrase!.phrase).toBe("vibe coding");
    expect(phrase!.doc_count).toBeGreaterThanOrEqual(2);
    expect(phrase!.quality_score).toBeGreaterThan(0);

    const auditRows = await env.DB.prepare(
      "SELECT source, raw_candidate, decision, decision_reason FROM topic_candidate_audit ORDER BY id"
    ).all<{ source: string; raw_candidate: string; decision: string; decision_reason: string }>();
    expect(auditRows.results.length).toBeGreaterThan(0);
    expect(auditRows.results.some((row: { decision: string }) => row.decision === "rejected")).toBe(true);

    const phraseTopic = await env.DB.prepare(
      "SELECT kind FROM topics WHERE slug = 'vibe-coding'"
    ).first<{ kind: string }>();
    expect(phraseTopic).not.toBeNull();
    expect(phraseTopic!.kind).toBe("phrase");
  });

  it("backfills phrase topics across earlier batches once corpus support appears", async () => {
    const chunks = [
      ["phrase-early-1", "Phrase Early 1", "Vibe coding changes how teams ship."],
      ["phrase-early-2", "Phrase Early 2", "Teams are adopting vibe coding in product work."],
      ["phrase-mid", "Phrase Mid", "A filler chunk without the key phrase."],
      ["phrase-late-1", "Phrase Late 1", "Vibe coding keeps accelerating software teams."],
      ["phrase-late-2", "Phrase Late 2", "Writers keep returning to vibe coding in practice."],
      ["phrase-late-3", "Phrase Late 3", "Another note about vibe coding and design."],
    ] as const;

    await env.DB.batch(chunks.map(([slug, title, text], position) =>
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, ?, ?, ?, ?, ?)`
      ).bind(slug, title, text, text, position)
    ));

    await enrichChunks(env.DB, 2);
    await enrichChunks(env.DB, 2);
    await enrichChunks(env.DB, 2);
    const { finalizeEnrichment } = await import("./ingest");
    await finalizeEnrichment(env.DB);

    const phraseLinks = await env.DB.prepare(
      `SELECT c.slug
       FROM chunk_topics ct
       JOIN topics t ON ct.topic_id = t.id
       JOIN chunks c ON ct.chunk_id = c.id
       WHERE t.slug = 'vibe-coding'
       ORDER BY c.slug`
    ).all<{ slug: string }>();

    expect(phraseLinks.results.map((row: { slug: string }) => row.slug)).toEqual([
      "phrase-early-1",
      "phrase-early-2",
      "phrase-late-1",
      "phrase-late-2",
      "phrase-late-3",
    ]);

    const phraseTopic = await env.DB.prepare(
      "SELECT provenance_complete FROM topics WHERE slug = 'vibe-coding'"
    ).first<{ provenance_complete: number }>();
    expect(phraseTopic?.provenance_complete).toBe(1);
  });
});
