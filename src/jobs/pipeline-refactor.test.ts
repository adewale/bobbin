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
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-13', 'Ep 2', '2025-01-13', 2025, 1, 13, 2)"
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
         VALUES (2, 'chunk-2', 'Chunk 2', 'Vibe coding changes how teams ship software.', 'Vibe coding changes how teams ship software.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'chunk-3', 'Chunk 3', 'Vibe coding keeps changing team habits.', 'Vibe coding keeps changing team habits.', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'chunk-4', 'Chunk 4', 'Teams revisit vibe coding in production.', 'Teams revisit vibe coding in production.', 1)`
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
      [1, "phrase-early-1", "Phrase Early 1", "Vibe coding changes how teams ship."],
      [1, "phrase-early-2", "Phrase Early 2", "Teams are adopting vibe coding in product work."],
      [1, "phrase-mid", "Phrase Mid", "A filler chunk without the key phrase."],
      [2, "phrase-late-1", "Phrase Late 1", "Vibe coding keeps accelerating software teams."],
      [2, "phrase-late-2", "Phrase Late 2", "Writers keep returning to vibe coding in practice."],
      [2, "phrase-late-3", "Phrase Late 3", "Another note about vibe coding and design."],
    ] as const;

    await env.DB.batch(chunks.map(([episodeId, slug, title, text], position) =>
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(episodeId, slug, title, text, text, position)
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

  it("defers promotion until a topic spans multiple episodes, then backfills prior accepted candidates", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, analysis_text, normalization_version, enriched, enrichment_version, position)
         VALUES (1, 'ep1-1', 'Ep1-1', 'Disconfirming evidence matters.', 'Disconfirming evidence matters.', 'disconfirming evidence matters', 1, 1, 5, 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, analysis_text, normalization_version, enriched, enrichment_version, position)
         VALUES (1, 'ep1-2', 'Ep1-2', 'More disconfirming evidence arrives.', 'More disconfirming evidence arrives.', 'more disconfirming evidence arrives', 1, 1, 5, 1)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'ep2-1', 'Ep2-1', 'Disconfirming evidence changes beliefs.', 'Disconfirming evidence changes beliefs.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'ep2-2', 'Ep2-2', 'Teams collect disconfirming evidence carefully.', 'Teams collect disconfirming evidence carefully.', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO topic_candidate_audit (
           chunk_id, source, stage, raw_candidate, normalized_candidate, topic_name, slug,
           score, kind, decision, decision_reason, provenance
         ) VALUES
         (1, 'phrase_lexicon', 'promotion_deferred', 'disconfirming evidence', 'disconfirming evidence', 'disconfirming evidence', 'disconfirming-evidence', 4, 'phrase', 'accepted', 'insufficient_episode_support', '[]'),
         (2, 'phrase_lexicon', 'promotion_deferred', 'disconfirming evidence', 'disconfirming evidence', 'disconfirming evidence', 'disconfirming-evidence', 4, 'phrase', 'accepted', 'insufficient_episode_support', '[]')`
      ),
    ]);

    await enrichChunks(env.DB, 2, "yaket_bobbin");

    const topic = await env.DB.prepare(
      "SELECT id, kind FROM topics WHERE slug = 'disconfirming-evidence'"
    ).first<{ id: number; kind: string }>();
    expect(topic).not.toBeNull();
    expect(topic?.kind).toBe("phrase");

    const links = await env.DB.prepare(
      `SELECT c.slug
       FROM chunk_topics ct
       JOIN chunks c ON c.id = ct.chunk_id
       JOIN topics t ON t.id = ct.topic_id
       WHERE t.slug = 'disconfirming-evidence'
       ORDER BY c.slug`
    ).all<{ slug: string }>();
    expect(links.results.map((row) => row.slug)).toEqual(["ep1-1", "ep1-2", "ep2-1", "ep2-2"]);
  });

  it("episode_hybrid attributes episode-level phrase candidates only to matching chunks", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'hybrid-1', 'Hybrid 1', 'Prompt injection attack is a real security issue in agent systems.', 'Prompt injection attack is a real security issue in agent systems.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'hybrid-2', 'Hybrid 2', 'Teams keep discussing prompt injection attack in production.', 'Teams keep discussing prompt injection attack in production.', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'hybrid-3', 'Hybrid 3', 'This chunk is about business models instead.', 'This chunk is about business models instead.', 2)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'hybrid-4', 'Hybrid 4', 'Another prompt injection attack appears in this episode.', 'Another prompt injection attack appears in this episode.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'hybrid-5', 'Hybrid 5', 'Prompt injection attack remains a serious security issue.', 'Prompt injection attack remains a serious security issue.', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'hybrid-6', 'Hybrid 6', 'This one only mentions vibe coding.', 'This one only mentions vibe coding.', 2)`
      ),
    ]);

    await enrichChunks(env.DB, 100, "episode_hybrid");

    const phraseTopic = await env.DB.prepare(
      "SELECT kind FROM topics WHERE slug = 'prompt-injection-attack'"
    ).first<{ kind: string }>();
    expect(phraseTopic).not.toBeNull();

    const linkedChunks = await env.DB.prepare(
      `SELECT c.slug
       FROM chunk_topics ct
       JOIN chunks c ON c.id = ct.chunk_id
       JOIN topics t ON t.id = ct.topic_id
       WHERE t.slug = 'prompt-injection-attack'
       ORDER BY c.slug`
    ).all<{ slug: string }>();

    expect(linkedChunks.results.map((row) => row.slug)).toEqual([
      "hybrid-1",
      "hybrid-2",
      "hybrid-4",
      "hybrid-5",
    ]);
    expect(linkedChunks.results.map((row) => row.slug)).not.toContain("hybrid-3");
    expect(linkedChunks.results.map((row) => row.slug)).not.toContain("hybrid-6");
  });

  it("episode_hybrid preserves known entities as entities while using episode-level phrase generation", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'entity-hybrid-1', 'Entity Hybrid 1', 'OpenAI and Claude Code shipped updates for llms.', 'OpenAI and Claude Code shipped updates for llms.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'entity-hybrid-2', 'Entity Hybrid 2', 'Claude Code still helps teams use llms safely.', 'Claude Code still helps teams use llms safely.', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'entity-hybrid-3', 'Entity Hybrid 3', 'OpenAI keeps changing how teams work with llms.', 'OpenAI keeps changing how teams work with llms.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (2, 'entity-hybrid-4', 'Entity Hybrid 4', 'Claude Code and OpenAI both appear in this episode.', 'Claude Code and OpenAI both appear in this episode.', 1)`
      ),
    ]);

    await enrichChunks(env.DB, 100, "episode_hybrid");

    const entityKinds = await env.DB.prepare(
      "SELECT slug, kind FROM topics WHERE slug IN ('openai', 'claude-code') ORDER BY slug"
    ).all<{ slug: string; kind: string }>();

    expect(entityKinds.results).toEqual([
      { slug: 'claude-code', kind: 'entity' },
      { slug: 'openai', kind: 'entity' },
    ]);
  });
});
