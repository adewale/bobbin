/**
 * Tests for queue handler behavior.
 * Uses a real D1 database; queue messages are driven through
 * handleEnrichmentBatch with recording ack/retry/DLQ fakes.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { handleEnrichBatch, handleEnrichmentBatch, queueJobKey, queueRetryDelaySeconds, shouldRetryQueueMessage } from "./queue-handler";
import { CURRENT_ENRICHMENT_VERSION } from "./ingest";

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

afterEach(() => {
  vi.restoreAllMocks();
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

    // Verify: audit rows were created for processed chunks
    const topics = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topic_candidate_audit WHERE chunk_id IN (1, 2)"
    ).first<{ c: number }>();
    expect(topics!.c).toBeGreaterThan(0);

    // Verify: chunk_topics may or may not be promoted immediately, but chunk words are built for the processed chunks
    const ct = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_words WHERE chunk_id IN (1, 2)"
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

  it("handles chunk batches whose size exceeds the D1 bind cap", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO word_stats (word, total_count, doc_count) VALUES ('ecosystem', 200, 100)"
      ),
      env.DB.prepare(
        "INSERT INTO word_stats (word, total_count, doc_count) VALUES ('platform', 150, 90)"
      ),
    ]);

    const extraChunks = Array.from({ length: 120 }, (_, index) => {
      const n = index + 1;
      return env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, ?, ?, ?)"
      ).bind(
        `wide-batch-${n}`,
        `Wide batch ${n}`,
        `The ecosystem and platform pattern ${n}.`,
        `The ecosystem and platform pattern ${n}.`,
        n + 10,
      );
    });
    await env.DB.batch(extraChunks);

    const chunkIds = Array.from({ length: 123 }, (_, index) => index + 1);
    await handleEnrichBatch(env.DB, chunkIds);

    const enrichedCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE id IN (SELECT id FROM chunks WHERE slug LIKE 'wide-batch-%' OR slug LIKE 'chunk-%') AND enriched = 1"
    ).first<{ c: number }>();
    expect(enrichedCount!.c).toBe(123);

    const auditRows = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM topic_candidate_audit WHERE chunk_id IN (SELECT id FROM chunks WHERE slug LIKE 'wide-batch-%')"
    ).first<{ c: number }>();
    expect(auditRows!.c).toBeGreaterThan(0);

    const untouched = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE slug = 'chunk-3' AND enriched = 1"
    ).first<{ c: number }>();
    expect(untouched!.c).toBe(1);
  });
});

describe("queue job idempotency keys", () => {
  it("scopes enrich-batch keys to the current enrichment version", () => {
    const key = queueJobKey({ type: "enrich-batch", chunkIds: [3, 1, 2] });
    expect(key).toBe(`enrich-batch:v${CURRENT_ENRICHMENT_VERSION}:1,2,3`);
  });

  it("re-runs an enrich-batch whose chunk set completed under an older version", async () => {
    // A version bump re-derives the same deterministic chunk-id batches.
    // Keys recorded by earlier campaigns (legacy version-less format and
    // older versions) must NOT cause the new campaign to be skipped.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO queue_message_state (job_key, message_type, status, completed_at) VALUES ('enrich-batch:1,2', 'enrich-batch', 'completed', datetime('now'))"
      ),
      env.DB.prepare(
        `INSERT INTO queue_message_state (job_key, message_type, status, completed_at) VALUES ('enrich-batch:v${CURRENT_ENRICHMENT_VERSION - 1}:1,2', 'enrich-batch', 'completed', datetime('now'))`
      ),
    ]);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const ack = vi.fn();
    await handleEnrichmentBatch(
      {
        messages: [
          { id: "rerun-msg", attempts: 1, body: { type: "enrich-batch", chunkIds: [1, 2] }, ack, retry: vi.fn() },
        ],
      } as any,
      { DB: env.DB, ENRICHMENT_QUEUE: {} } as any,
    );

    expect(ack).toHaveBeenCalledTimes(1);
    const enriched = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE id IN (1, 2) AND enriched = 1"
    ).first<{ c: number }>();
    expect(enriched!.c).toBe(2);
  });
});

describe("queue message event logs", () => {
  it("emits one wide JSON success line per processed message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    await handleEnrichmentBatch(
      {
        messages: [
          {
            body: { type: "enrich-batch", chunkIds: [1, 2] },
            ack,
            retry,
          },
        ],
      } as any,
      { DB: env.DB, ENRICHMENT_QUEUE: {} } as any,
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(String(logSpy.mock.calls[0][0]));
    expect(payload.event).toBe("queue_message");
    expect(payload.message_type).toBe("enrich-batch");
    expect(payload.status).toBe("ok");
    expect(payload.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(payload.chunk_count).toBe(2);
    expect(payload.chunks_processed).toBe(2);
  });

  it("acks and skips a queue job that already completed", async () => {
    const completedKey = queueJobKey({ type: "enrich-batch", chunkIds: [1, 2] });
    await env.DB.prepare(
      "INSERT INTO queue_message_state (job_key, message_id, message_type, status) VALUES (?, 'old-msg', 'enrich-batch', 'completed')"
    ).bind(completedKey).run();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    await handleEnrichmentBatch(
      {
        messages: [
          {
            id: "new-msg",
            attempts: 1,
            body: { type: "enrich-batch", chunkIds: [1, 2] },
            ack,
            retry,
          },
        ],
      } as any,
      { DB: env.DB, ENRICHMENT_QUEUE: {} } as any,
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    const payload = JSON.parse(String(logSpy.mock.calls[0][0]));
    expect(payload.status).toBe("skipped_completed");

    // Positive control: the chunks were not re-enriched
    const enriched = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE id IN (1, 2) AND enriched = 1"
    ).first<{ c: number }>();
    expect(enriched!.c).toBe(0);
  });

  it("records queue job state for successful messages", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleEnrichmentBatch(
      {
        messages: [
          {
            id: "msg-state-ok",
            attempts: 1,
            body: { type: "enrich-batch", chunkIds: [1] },
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      } as any,
      { DB: env.DB, ENRICHMENT_QUEUE: {} } as any,
    );

    const state = await env.DB.prepare(
      "SELECT message_id, message_type, status, attempts FROM queue_message_state WHERE job_key = ?"
    ).bind(queueJobKey({ type: "enrich-batch", chunkIds: [1] })).first<{ message_id: string; message_type: string; status: string; attempts: number }>();
    expect(state).toEqual({ message_id: "msg-state-ok", message_type: "enrich-batch", status: "completed", attempts: 1 });
  });

  it("emits one wide JSON error line and retries retryable failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    await handleEnrichmentBatch(
      {
        messages: [
          {
            body: { type: "enrich-batch", chunkIds: [1] },
            attempts: 2,
            ack,
            retry,
          },
        ],
      } as any,
      {
        DB: {
          prepare() {
            throw new Error("SQLITE_BUSY test failure");
          },
        },
        ENRICHMENT_QUEUE: {},
      } as any,
    );

    expect(retry).toHaveBeenCalledTimes(1);
    const retryOptions = retry.mock.calls[0][0];
    expect(retryOptions.delaySeconds).toBeGreaterThanOrEqual(30);
    expect(retryOptions.delaySeconds).toBeLessThan(60);
    expect(ack).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    const payload = JSON.parse(String(errorSpy.mock.calls.find((call) => String(call[0]).startsWith("{"))?.[0]));
    expect(payload.event).toBe("queue_message");
    expect(payload.message_type).toBe("enrich-batch");
    expect(payload.status).toBe("error");
    expect(payload.retry).toBe(true);
    expect(payload.error).toContain("SQLITE_BUSY");
    expect(payload.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it("forwards non-retryable failures to the dead-letter queue before acking", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();
    const dlqSend = vi.fn().mockResolvedValue(undefined);
    const body = { type: "enrich-batch" as const, chunkIds: [1] };

    await handleEnrichmentBatch(
      {
        messages: [{ body, attempts: 1, ack, retry }],
      } as any,
      {
        DB: {
          prepare() {
            throw new Error("D1_ERROR: too many SQL variables");
          },
        },
        ENRICHMENT_QUEUE: {},
        ENRICHMENT_DLQ: { send: dlqSend },
      } as any,
    );

    expect(retry).not.toHaveBeenCalled();
    expect(dlqSend).toHaveBeenCalledTimes(1);
    expect(dlqSend).toHaveBeenCalledWith(body);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("does not touch the dead-letter queue for retryable failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dlqSend = vi.fn().mockResolvedValue(undefined);

    await handleEnrichmentBatch(
      {
        messages: [{ body: { type: "enrich-batch", chunkIds: [1] }, attempts: 1, ack: vi.fn(), retry: vi.fn() }],
      } as any,
      {
        DB: {
          prepare() {
            throw new Error("SQLITE_BUSY test failure");
          },
        },
        ENRICHMENT_QUEUE: {},
        ENRICHMENT_DLQ: { send: dlqSend },
      } as any,
    );

    expect(dlqSend).not.toHaveBeenCalled();
  });
});

describe("queue retry policy", () => {
  it("computes bounded exponential retry delays with equal jitter", () => {
    expect(queueRetryDelaySeconds(undefined, () => 0)).toBe(15);
    expect(queueRetryDelaySeconds(1, () => 0.999)).toBe(29);
    expect(queueRetryDelaySeconds(2, () => 0)).toBe(30);
    expect(queueRetryDelaySeconds(2, () => 0.999)).toBe(59);
    expect(queueRetryDelaySeconds(5, () => 0)).toBe(150);
    expect(queueRetryDelaySeconds(5, () => 0.999)).toBe(299);
  });

  it("retries transient D1 and infrastructure errors", () => {
    expect(shouldRetryQueueMessage(new Error("D1_ERROR: Network connection lost"))).toBe(true);
    expect(shouldRetryQueueMessage(new Error("SQLITE_BUSY: database is locked"))).toBe(true);
    expect(shouldRetryQueueMessage(new Error("503 Service Unavailable"))).toBe(true);
    expect(shouldRetryQueueMessage(new Error("AiError: status 429"))).toBe(true);
  });

  it("does not retry deterministic application or SQL-shape failures", () => {
    expect(shouldRetryQueueMessage(new Error("D1_ERROR: too many SQL variables"))).toBe(false);
    expect(shouldRetryQueueMessage(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("does not mistake numbers inside identifiers for HTTP status codes", () => {
    // "5036" contains the substring "503"; a naive substring match retries this forever
    expect(shouldRetryQueueMessage(new Error("enrichment failed for chunk 5036"))).toBe(false);
    expect(shouldRetryQueueMessage(new Error("processed 429 chunks before failure"))).toBe(false);
  });
});
