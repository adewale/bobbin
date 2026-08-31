/**
 * Tests for queue handler behavior.
 * Uses a real D1 database; queue messages are driven through
 * handleEnrichmentBatch with recording ack/retry/DLQ fakes.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fc from "fast-check";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import {
  claimQueueJob,
  completeQueueJob,
  failQueueJob,
  handleEnrichBatch,
  handleEnrichmentBatch,
  QUEUE_JOB_LEASE_SECONDS,
  queueJobKey,
  queueRetryDelaySeconds,
  shouldRetryQueueMessage,
  type EnrichmentMessage,
} from "./queue-handler";
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

describe("queue job lifecycle model", () => {
  const bodies: EnrichmentMessage[] = [
    { type: "enrich-batch", chunkIds: [1] },
    { type: "enrich-batch", chunkIds: [2] },
    { type: "enrich-batch", chunkIds: [2, 1] },
    { type: "llm-episode-enrich", episodeId: 1 },
  ];
  type JobStatus = "running" | "retrying" | "failed" | "completed";
  type JobState = {
    status: JobStatus;
    leaseToken: string | null;
    leaseExpiresAt: number | null;
  };
  type Model = { now: number; jobs: Map<string, JobState> };
  type Real = { db: D1Database };
  type Action =
    | { kind: "claim"; bodyIndex: number; attempts: number; leaseToken: string }
    | { kind: "complete"; bodyIndex: number; owner: "current" | "stale" }
    | { kind: "fail"; bodyIndex: number; owner: "current" | "stale"; status: "retrying" | "failed" }
    | { kind: "elapse"; seconds: number };

  class QueueCommand implements fc.AsyncCommand<Model, Real> {
    constructor(private readonly action: Action) {}

    check(): boolean {
      return true;
    }

    async run(model: Model, real: Real): Promise<void> {
      const action = this.action;
      if (action.kind === "elapse") {
        model.now += action.seconds;
      } else {
        const body = bodies[action.bodyIndex % bodies.length];
        const key = queueJobKey(body);
        const before = model.jobs.get(key);
        if (action.kind === "claim") {
          const activeLease = before?.status === "running"
            && before.leaseExpiresAt !== null
            && before.leaseExpiresAt > model.now;
          const expected = before?.status === "completed"
            ? "completed"
            : activeLease
              ? "in_progress"
              : "run";
          const actual = await claimQueueJob(
            real.db,
            `message-${action.bodyIndex}-${action.attempts}`,
            body,
            action.attempts,
            { nowEpochSeconds: model.now, leaseToken: action.leaseToken },
          );
          expect(actual.state).toBe(expected);
          if (actual.state === "in_progress") {
            expect(actual.retryAfterSeconds).toBe(before!.leaseExpiresAt! - model.now + 1);
          } else if (actual.state === "run") {
            expect(actual.leaseToken).toBe(action.leaseToken);
            model.jobs.set(key, {
              status: "running",
              leaseToken: action.leaseToken,
              leaseExpiresAt: model.now + QUEUE_JOB_LEASE_SECONDS,
            });
          }
        } else {
          const token = action.owner === "current" && before?.leaseToken
            ? before.leaseToken
            : `stale-${action.bodyIndex}`;
          const expected = before?.status === "running" && before.leaseToken === token;
          if (action.kind === "complete") {
            expect(await completeQueueJob(real.db, body, token)).toBe(expected);
            if (expected) {
              model.jobs.set(key, { status: "completed", leaseToken: null, leaseExpiresAt: null });
            }
          } else {
            expect(await failQueueJob(real.db, body, token, action.status, new Error("model failure"))).toBe(expected);
            if (expected) {
              model.jobs.set(key, { status: action.status, leaseToken: null, leaseExpiresAt: null });
            }
          }
        }
      }

      const rows = await real.db.prepare(
        `SELECT job_key, status, lease_token,
                unixepoch(lease_expires_at) AS lease_expires_at
         FROM queue_message_state ORDER BY job_key`
      ).all<{
        job_key: string;
        status: JobStatus;
        lease_token: string | null;
        lease_expires_at: number | null;
      }>();
      const actualJobs = rows.results.map((row) => [row.job_key, {
        status: row.status,
        leaseToken: row.lease_token,
        leaseExpiresAt: row.lease_expires_at,
      }] as const);
      const expectedJobs = [...model.jobs].sort(([left], [right]) => left.localeCompare(right));
      expect(actualJobs).toEqual(expectedJobs);
    }

    toString(): string {
      return JSON.stringify(this.action);
    }
  }

  const bodyIndex = fc.integer({ min: 0, max: bodies.length - 1 });
  const commandArbs = [
    fc.tuple(bodyIndex, fc.integer({ min: 1, max: 8 }), fc.uuid())
      .map(([index, attempts, leaseToken]) => new QueueCommand({
        kind: "claim", bodyIndex: index, attempts, leaseToken,
      })),
    fc.tuple(bodyIndex, fc.constantFrom<"current" | "stale">("current", "stale"))
      .map(([index, owner]) => new QueueCommand({ kind: "complete", bodyIndex: index, owner })),
    fc.tuple(
      bodyIndex,
      fc.constantFrom<"current" | "stale">("current", "stale"),
      fc.constantFrom<"retrying" | "failed">("retrying", "failed"),
    ).map(([index, owner, status]) => new QueueCommand({
      kind: "fail", bodyIndex: index, owner, status,
    })),
    fc.integer({ min: 0, max: QUEUE_JOB_LEASE_SECONDS * 2 })
      .map((seconds) => new QueueCommand({ kind: "elapse", seconds })),
  ];

  it("atomically admits only one of two concurrent deliveries", async () => {
    const body: EnrichmentMessage = { type: "enrich-batch", chunkIds: [1, 2] };
    const claims = await Promise.all([
      claimQueueJob(env.DB, "first", body, 1, { nowEpochSeconds: 1_700_000_000, leaseToken: "first-lease" }),
      claimQueueJob(env.DB, "duplicate", body, 1, { nowEpochSeconds: 1_700_000_000, leaseToken: "duplicate-lease" }),
    ]);
    expect(claims.map((claim) => claim.state).sort()).toEqual(["in_progress", "run"]);
  });

  it("recovers an abandoned claim after its lease and fences the stale owner", async () => {
    const body: EnrichmentMessage = { type: "enrich-batch", chunkIds: [1, 2] };
    const now = 1_700_000_000;
    expect(await claimQueueJob(env.DB, "crashed", body, 1, {
      nowEpochSeconds: now,
      leaseToken: "abandoned-lease",
    })).toEqual({ state: "run", leaseToken: "abandoned-lease" });

    expect(await claimQueueJob(env.DB, "early-retry", body, 2, {
      nowEpochSeconds: now + QUEUE_JOB_LEASE_SECONDS - 1,
      leaseToken: "early-lease",
    })).toEqual({ state: "in_progress", retryAfterSeconds: 2 });

    expect(await claimQueueJob(env.DB, "recovery", body, 3, {
      nowEpochSeconds: now + QUEUE_JOB_LEASE_SECONDS,
      leaseToken: "recovery-lease",
    })).toEqual({ state: "run", leaseToken: "recovery-lease" });
    expect(await completeQueueJob(env.DB, body, "abandoned-lease")).toBe(false);
    expect(await failQueueJob(env.DB, body, "abandoned-lease", "failed", new Error("late"))).toBe(false);
    expect(await completeQueueJob(env.DB, body, "recovery-lease")).toBe(true);
  });

  it("matches claim, completion, failure, retry, and reordering semantics", async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commandArbs, { maxCommands: 30 }), async (commands) => {
        await env.DB.prepare("DELETE FROM queue_message_state").run();
        await fc.asyncModelRun(() => ({
          model: { now: 1_700_000_000, jobs: new Map() },
          real: { db: env.DB },
        }), commands);
      }),
      { numRuns: 100 },
    );
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

  it("defers a duplicate while the first delivery is still running", async () => {
    const body = { type: "enrich-batch" as const, chunkIds: [1, 2] };
    await claimQueueJob(env.DB, "first-msg", body, 1);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    await handleEnrichmentBatch(
      {
        messages: [{ id: "duplicate-msg", attempts: 2, body, ack, retry }],
      } as any,
      { DB: env.DB, ENRICHMENT_QUEUE: {} } as any,
    );

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0].delaySeconds).toBeGreaterThanOrEqual(QUEUE_JOB_LEASE_SECONDS - 1);
    expect(retry.mock.calls[0][0].delaySeconds).toBeLessThanOrEqual(QUEUE_JOB_LEASE_SECONDS + 1);
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).status).toBe("deferred_in_progress");
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
