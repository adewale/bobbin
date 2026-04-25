import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../test/helpers/migrations";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("D1 best-practice bootstrap", () => {
  it("applies the real migration chain and creates hardening indexes", async () => {
    const rows = await env.DB.prepare(
      `SELECT name, type
       FROM sqlite_schema
       WHERE name IN (
         'chunks_fts',
         'idx_topic_candidate_audit_decision_slug_chunk',
         'idx_llm_episode_candidate_evidence_chunk',
         'idx_episodes_source_published',
         'idx_chunks_episode_position',
         'idx_chunks_enrichment_version_id'
       )
       ORDER BY name ASC`
    ).all<{ name: string; type: string }>();

    expect(rows.results).toEqual([
      { name: "chunks_fts", type: "table" },
      { name: "idx_chunks_enrichment_version_id", type: "index" },
      { name: "idx_chunks_episode_position", type: "index" },
      { name: "idx_episodes_source_published", type: "index" },
      { name: "idx_llm_episode_candidate_evidence_chunk", type: "index" },
      { name: "idx_topic_candidate_audit_decision_slug_chunk", type: "index" },
    ]);
  });

  it("uses composite episode and chunk ordering indexes in query plans", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('src', 'Source')"),
      env.DB.prepare(
        "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, 'ep-1', 'Ep 1', '2025-01-01', 2025, 1, 1, 2)"
      ),
      env.DB.prepare(
        "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, 'ep-2', 'Ep 2', '2025-02-01', 2025, 2, 1, 2)"
      ),
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-2', 'Chunk 2', 'b', 'b', 1)"
      ),
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-1', 'Chunk 1', 'a', 'a', 0)"
      ),
    ]);

    const episodePlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT published_date FROM episodes WHERE source_id = 1 ORDER BY published_date ASC"
    ).all<{ detail: string }>();
    const chunkPlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT id, slug FROM chunks WHERE episode_id = 2 ORDER BY position"
    ).all<{ detail: string }>();

    expect(episodePlan.results.some((row) => row.detail.includes("idx_episodes_source_published"))).toBe(true);
    expect(chunkPlan.results.some((row) => row.detail.includes("idx_chunks_episode_position"))).toBe(true);
    expect(chunkPlan.results.every((row) => !row.detail.includes("USE TEMP B-TREE FOR ORDER BY"))).toBe(true);
  });

  it("uses the new audit and llm evidence indexes in query plans", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('src', 'Source')"),
      env.DB.prepare(
        "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, 'ep-1', 'Ep 1', '2025-01-01', 2025, 1, 1, 1)"
      ),
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1', 'Chunk 1', 'ChatGPT note', 'ChatGPT note', 0)"
      ),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('chatgpt', 'chatgpt', 1)"),
      env.DB.prepare(
        "INSERT INTO topic_candidate_audit (chunk_id, source, stage, raw_candidate, normalized_candidate, topic_name, slug, score, kind, decision, decision_reason, provenance) VALUES (1, 'test', 'candidate_processing', 'ChatGPT', 'chatgpt', 'chatgpt', 'chatgpt', 1, 'concept', 'accepted', 'ok', 'test')"
      ),
      env.DB.prepare(
        "INSERT INTO llm_enrichment_runs (source_id, episode_id, extractor_model, prompt_version, schema_version) VALUES (1, 1, 'model', 'v1', 'v1')"
      ),
      env.DB.prepare(
        "INSERT INTO llm_episode_candidates (run_id, episode_id, candidate_name, normalized_name, slug, kind, confidence, rank_position, aliases_json) VALUES (1, 1, 'ChatGPT', 'chatgpt', 'chatgpt', 'concept', 0.9, 0, '[]')"
      ),
      env.DB.prepare(
        "INSERT INTO llm_episode_candidate_evidence (candidate_id, chunk_id, chunk_slug, quote) VALUES (1, 1, 'chunk-1', 'ChatGPT note')"
      ),
    ]);

    const auditPlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT DISTINCT a.chunk_id, a.slug FROM topic_candidate_audit a WHERE a.decision = 'accepted' AND a.slug IN ('chatgpt')"
    ).all<{ detail: string }>();
    const llmPlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT e.chunk_id, c.slug FROM llm_episode_candidate_evidence e JOIN llm_episode_candidates c ON c.id = e.candidate_id WHERE e.chunk_id IN (1)"
    ).all<{ detail: string }>();

    expect(auditPlan.results.some((row) => row.detail.includes("idx_topic_candidate_audit_decision_slug_chunk"))).toBe(true);
    expect(llmPlan.results.some((row) => row.detail.includes("idx_llm_episode_candidate_evidence_chunk"))).toBe(true);
  });
});
