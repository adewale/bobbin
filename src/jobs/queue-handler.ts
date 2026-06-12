/**
 * Queue consumer for enrichment work.
 *
 * Handles two message types:
 * - "enrich-batch": enrich specific chunks by ID (parallel fan-out from /api/enrich-parallel)
 * - "llm-episode-enrich": run LLM ingest enrichment for a single episode
 */
import { collectInBatches, sqlPlaceholders } from "../lib/db";
import { rebuildWordStatsAggregates } from "../services/word-stats";
import { enrichEpisodeIdsWithLlm } from "../services/llm-ingest";
import { normalizeTopicExtractorMode, type TopicExtractorMode } from "../services/yake-runtime";
import { CURRENT_ENRICHMENT_VERSION, loadPhraseLexiconForEnrichment, processChunkBatch } from "./ingest";
import type { Bindings } from "../types";

export interface EnrichmentMessage {
  type: "enrich-batch" | "llm-episode-enrich";
  // enrich-batch
  chunkIds?: number[];
  // llm-episode-enrich
  episodeId?: number;
}

// Transient infrastructure failures worth retrying. HTTP status codes are
// matched in an error/status context, not as bare substrings — a message like
// "chunk 5036 failed" must not match 503.
const RETRYABLE_QUEUE_ERROR_PATTERNS: RegExp[] = [
  /Network connection lost/i,
  /storage caused object to be reset/i,
  /reset because its code was updated/i,
  /SQLITE_BUSY/,
  /SQLITE_LOCKED/,
  /Too Many Requests/i,
  /Service Unavailable/i,
  /Gateway Time-?out/i,
  /\b(?:status|code|error)\b[^0-9]{0,4}(?:429|503|504)\b/i,
];

export function queueRetryDelaySeconds(
  attempts: number | undefined,
  random: () => number = Math.random,
): number {
  const safeAttempts = Math.max(1, attempts ?? 1);
  const maxDelay = Math.min(300, 30 * 2 ** (safeAttempts - 1));
  const jittered = Math.floor(maxDelay / 2 + random() * (maxDelay / 2));
  return Math.max(1, jittered);
}

export function shouldRetryQueueMessage(error: unknown): boolean {
  const message = String(error);
  return RETRYABLE_QUEUE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function queueJobKey(body: EnrichmentMessage): string {
  // enrich-batch keys include the enrichment version: bumping
  // CURRENT_ENRICHMENT_VERSION re-derives the same deterministic chunk-id
  // batches, and a version-less key would match the previous campaign's
  // completed rows and silently skip the re-enrichment.
  if (body.type === "enrich-batch") {
    const ids = [...(body.chunkIds ?? [])].sort((a, b) => a - b).join(",");
    return `enrich-batch:v${CURRENT_ENRICHMENT_VERSION}:${ids}`;
  }
  if (body.type === "llm-episode-enrich") return `llm-episode-enrich:${body.episodeId ?? ""}`;
  return JSON.stringify(body);
}

async function beginQueueJob(db: D1Database, messageId: string | undefined, body: EnrichmentMessage, attempts: number | undefined): Promise<"run" | "completed"> {
  const jobKey = queueJobKey(body);
  const existing = await db.prepare("SELECT status FROM queue_message_state WHERE job_key = ?").bind(jobKey).first<{ status: string }>();
  if (existing?.status === "completed") return "completed";

  await db.prepare(
    `INSERT INTO queue_message_state (job_key, message_id, message_type, status, attempts, updated_at)
     VALUES (?, ?, ?, 'running', ?, datetime('now'))
     ON CONFLICT(job_key) DO UPDATE SET
       message_id = excluded.message_id,
       status = CASE WHEN queue_message_state.status = 'completed' THEN 'completed' ELSE 'running' END,
       attempts = excluded.attempts,
       updated_at = datetime('now')`
  ).bind(jobKey, messageId ?? null, body.type, Math.max(1, attempts ?? 1)).run();
  return "run";
}

async function completeQueueJob(db: D1Database, body: EnrichmentMessage): Promise<void> {
  await db.prepare(
    `UPDATE queue_message_state
     SET status = 'completed', last_error = NULL, updated_at = datetime('now'), completed_at = datetime('now')
     WHERE job_key = ?`
  ).bind(queueJobKey(body)).run();
}

async function failQueueJob(db: D1Database, body: EnrichmentMessage, status: "retrying" | "failed", error: unknown): Promise<void> {
  await db.prepare(
    `UPDATE queue_message_state
     SET status = ?, last_error = ?, updated_at = datetime('now')
     WHERE job_key = ?`
  ).bind(status, (error instanceof Error ? error.message : String(error)).substring(0, 500), queueJobKey(body)).run();
}

export async function handleEnrichBatch(
  db: D1Database,
  chunkIds: number[],
  extractorMode: TopicExtractorMode = "naive",
) {
  if (!chunkIds.length) return { chunks_processed: 0 };

  // Load chunks by ID and process using shared logic
  const chunkRows = await collectInBatches(chunkIds, async (chunkIdBatch) => {
    const placeholders = sqlPlaceholders(chunkIdBatch.length);
    const chunks = await db.prepare(
      `SELECT id, episode_id, content_plain FROM chunks WHERE id IN (${placeholders})`
    ).bind(...chunkIdBatch).all<{ id: number; episode_id: number; content_plain: string }>();
    return chunks.results;
  });

  if (!chunkRows.length) return { chunks_processed: 0 };

  // Use the shared processChunkBatch — single source of truth
  const phraseLexicon = await loadPhraseLexiconForEnrichment(db);
  await processChunkBatch(db, chunkRows, extractorMode, {
    phraseLexiconOverride: phraseLexicon,
    rebuildWordStats: false,
  });
  await rebuildWordStatsAggregates(db);
  return { chunks_processed: chunkRows.length };
}

function queueMessageContext(body: EnrichmentMessage): Record<string, string | number> {
  if (body.type === "enrich-batch" && body.chunkIds) return { chunk_count: body.chunkIds.length };
  if (body.type === "llm-episode-enrich" && body.episodeId) return { episode_id: body.episodeId };
  return {};
}

// Non-retryable failures are acked (retrying a deterministic failure wastes
// the retry budget), so Cloudflare's retries-exhausted DLQ routing never sees
// them. Forward them to the DLQ explicitly so the replay procedure in
// docs/queue-dlq-replay.md still applies after the bug is fixed.
async function forwardToDeadLetter(env: Bindings, body: EnrichmentMessage): Promise<boolean> {
  if (!env.ENRICHMENT_DLQ) return false;
  try {
    await env.ENRICHMENT_DLQ.send(body);
    return true;
  } catch (e) {
    console.error(JSON.stringify({
      event: "queue_dlq_forward_failed",
      message_type: body.type,
      error: e instanceof Error ? e.message : String(e),
    }));
    return false;
  }
}

export async function handleEnrichmentBatch(
  batch: MessageBatch<EnrichmentMessage>,
  env: Bindings
): Promise<void> {
  const messages = [...batch.messages];
  const concurrency = Math.min(5, messages.length);
  const extractorMode = normalizeTopicExtractorMode(env.TOPIC_EXTRACTOR_MODE);
  let index = 0;

  async function processOne(msg: Message<EnrichmentMessage>) {
    const startedAt = Date.now();
    const context = queueMessageContext(msg.body);
    try {
      const jobState = await beginQueueJob(env.DB, (msg as { id?: string }).id, msg.body, (msg as { attempts?: number }).attempts);
      if (jobState === "completed") {
        msg.ack();
        console.log(JSON.stringify({
          event: "queue_message",
          message_type: msg.body.type,
          status: "skipped_completed",
          elapsed_ms: Date.now() - startedAt,
          ...context,
        }));
        return;
      }

      let counts: Record<string, number> = {};
      if (msg.body.type === "enrich-batch" && msg.body.chunkIds) {
        counts = await handleEnrichBatch(env.DB, msg.body.chunkIds, extractorMode);
      } else if (msg.body.type === "llm-episode-enrich" && msg.body.episodeId) {
        await enrichEpisodeIdsWithLlm(env, [msg.body.episodeId]);
        counts = { episodes_processed: 1 };
      }
      await completeQueueJob(env.DB, msg.body);
      msg.ack();
      console.log(JSON.stringify({
        event: "queue_message",
        message_type: msg.body.type,
        status: "ok",
        elapsed_ms: Date.now() - startedAt,
        ...context,
        ...counts,
      }));
    } catch (e) {
      const retryable = shouldRetryQueueMessage(e);
      console.error(JSON.stringify({
        event: "queue_message",
        message_type: msg.body.type,
        status: "error",
        elapsed_ms: Date.now() - startedAt,
        retry: retryable,
        error: e instanceof Error ? e.message : String(e),
        ...context,
      }));
      try {
        await failQueueJob(env.DB, msg.body, retryable ? "retrying" : "failed", e);
      } catch (stateError) {
        console.error("Queue job state update failed:", stateError);
      }
      if (retryable) {
        msg.retry({ delaySeconds: queueRetryDelaySeconds((msg as { attempts?: number }).attempts) });
      } else {
        await forwardToDeadLetter(env, msg.body);
        msg.ack();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < messages.length) {
      const current = messages[index++];
      if (!current) return;
      await processOne(current);
    }
  }));
}
