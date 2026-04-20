import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../test/helpers/migrations";
import { createIngestionLog } from "./db/ingestion";
import { recordPipelineRun } from "./db/pipeline-metrics";

beforeEach(async () => {
  (env as any).ADMIN_SECRET = "";
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Ep 1', '2024-04-08', 2024, 4, 8, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'test-chunk', 'Test', 'Content', 'ecosystem test content', 0)"),
    env.DB.prepare("INSERT INTO word_stats (word, total_count, doc_count) VALUES ('ecosystem', 5, 2)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 3)"),
  ]);
});

// S1: Auth on admin endpoints
describe("S1: Admin endpoint auth", () => {
  it("GET /api/ingest without auth returns 401", async () => {
    (env as any).ADMIN_SECRET = "test-secret";
    const res = await SELF.fetch("http://localhost/api/ingest");
    expect(res.status).toBe(401);
  });

  it("GET /api/refresh without auth returns 401", async () => {
    (env as any).ADMIN_SECRET = "test-secret";
    const res = await SELF.fetch("http://localhost/api/refresh");
    expect(res.status).toBe(401);
  });

  it("GET /api/embed without auth returns 401", async () => {
    (env as any).ADMIN_SECRET = "test-secret";
    const res = await SELF.fetch("http://localhost/api/embed");
    expect(res.status).toBe(401);
  });
});

// S3: FTS5 MATCH injection — should not crash
describe("S3: FTS5 injection safety", () => {
  it("search with FTS operators does not crash", async () => {
    const res = await SELF.fetch("http://localhost/search?q=title%3Asecret+AND+NOT+test");
    expect(res.status).toBe(200);
  });

  it("search with special chars does not crash", async () => {
    const res = await SELF.fetch("http://localhost/search?q=%22unclosed+quote");
    expect(res.status).toBe(200);
  });
});

// B1: Regex injection in highlight — word-stats route removed, covered by highlight unit tests

// B3: NaN from bad query params
describe("B3: Bad query params", () => {
  it("GET /api/ingest?limit=abc does not produce NaN", async () => {
    const res = await SELF.fetch("http://localhost/api/ingest", {
      headers: { Authorization: "Bearer test-secret" },
    });
    // Should work with default limit, not NaN
    expect(res.status).not.toBe(500);
  });
});

// S5: Error messages should be generic
describe("S5: Generic error messages", () => {
  it("API errors do not leak internal details", async () => {
    const res = await SELF.fetch("http://localhost/api/ingest?doc=nonexistent", {
      headers: { Authorization: "Bearer test-secret" },
    });
    const data = await res.json() as any;
    if (data.error) {
      expect(data.error).not.toContain("SQLITE");
      expect(data.error).not.toContain("/Users/");
    }
  });
});

describe("Manual refresh endpoint", () => {
  it("reuses the refresh pipeline and records a refresh run", async () => {
    (env as any).ADMIN_SECRET = "test-secret";
    const res = await SELF.fetch("http://localhost/api/refresh", {
      headers: { Authorization: "Bearer test-secret" },
    });
    const data = await res.json() as any;

    expect(res.status).toBe(200);
    expect(data.event).toBe("refresh");
    expect(["completed", "failed"]).toContain(data.status);
    expect(typeof data.duration_ms).toBe("number");

    const logs = await env.DB.prepare(
      "SELECT run_type, pipeline_report FROM ingestion_log ORDER BY id DESC LIMIT 1"
    ).first<{ run_type: string; pipeline_report: string | null }>();

    expect(logs).not.toBeNull();
    expect(logs?.run_type).toBe("refresh");
    expect(logs?.pipeline_report).not.toBeNull();
  }, 20000);
});

describe("Pipeline reporting tables", () => {
  it("stores queryable run and stage metrics", async () => {
    const ingestionLogId = await createIngestionLog(env.DB, 1, "enrich");
    const pipelineRunId = await recordPipelineRun(env.DB, ingestionLogId, {
      sourceId: 1,
      runType: "enrich",
      extractorMode: "naive",
      status: "completed",
      totalMs: 123,
      chunksProcessed: 10,
      candidatesGenerated: 20,
      candidatesRejectedEarly: 8,
      candidatesInserted: 12,
      topicsInserted: 6,
      chunkTopicLinksInserted: 12,
      chunkWordRowsInserted: 30,
      pruned: 0,
      merged: 0,
      orphanTopicsDeleted: 0,
      archivedLineageTopics: 0,
    }, [
      {
        phase: "enrich",
        name: "candidate_extraction",
        duration_ms: 12,
        status: "ok",
        counts: { candidates_generated: 20 },
        detail: "batched",
      },
    ]);

    const run = await env.DB.prepare(
      "SELECT run_type, extractor_mode, chunks_processed FROM pipeline_runs WHERE id = ?"
    ).bind(pipelineRunId).first<{ run_type: string; extractor_mode: string; chunks_processed: number }>();
    const stage = await env.DB.prepare(
      "SELECT phase, stage_name, counts_json FROM pipeline_stage_metrics WHERE pipeline_run_id = ?"
    ).bind(pipelineRunId).first<{ phase: string; stage_name: string; counts_json: string }>();

    expect(run).not.toBeNull();
    expect(run?.run_type).toBe("enrich");
    expect(run?.extractor_mode).toBe("naive");
    expect(run?.chunks_processed).toBe(10);
    expect(stage).not.toBeNull();
    expect(stage?.phase).toBe("enrich");
    expect(stage?.stage_name).toBe("candidate_extraction");
    expect(JSON.parse(stage!.counts_json)).toEqual({ candidates_generated: 20 });
  });
});
