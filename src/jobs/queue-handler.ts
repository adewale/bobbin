/**
 * Queue consumer for enrichment finalization.
 *
 * Handles four message types:
 * - "compute-related": compute related_slugs for a single topic
 * - "assign-ngram": create a phrase topic and assign to matching chunks
 * - "extract-ngrams": load all chunk texts, extract corpus n-grams, and dispatch assign-ngram messages
 * - "enrich-batch": enrich specific chunks by ID (parallel fan-out from /api/enrich-parallel)
 */
import { slugify } from "../lib/slug";
import { batchExec, collectInBatches, sqlPlaceholders } from "../lib/db";
import { topicSupportThreshold } from "../lib/topic-metrics";
import { extractCorpusNgrams } from "../services/ngram-extractor";
import { extractPMIPhrases } from "../services/pmi-phrases";
import { rebuildWordStatsAggregates } from "../services/word-stats";
import { enrichEpisodeIdsWithLlm } from "../services/llm-ingest";
import { loadPhraseLexiconForEnrichment, processChunkBatch } from "./ingest";
import type { Bindings } from "../types";

export interface EnrichmentMessage {
  type: "compute-related" | "assign-ngram" | "extract-ngrams" | "enrich-batch" | "llm-episode-enrich";
  // compute-related
  topicId?: number;
  // assign-ngram
  phrase?: string;
  // enrich-batch
  chunkIds?: number[];
  // llm-episode-enrich
  episodeId?: number;
}

const RETRYABLE_QUEUE_ERROR_PATTERNS = [
  "Network connection lost",
  "storage caused object to be reset",
  "reset because its code was updated",
  "SQLITE_BUSY",
  "SQLITE_BUSY_RECOVERY",
  "SQLITE_LOCKED",
  "Too Many Requests",
  "429",
  "503",
  "504",
];

export function shouldRetryQueueMessage(error: unknown): boolean {
  const message = String(error);
  return RETRYABLE_QUEUE_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

async function handleComputeRelated(db: D1Database, topicId: number) {
  const totalEpisodes = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
  const minEpisodeSupport = topicSupportThreshold(totalEpisodes?.c ?? 0);
  let related = await db.prepare(
    `SELECT t.slug
     FROM topic_similarity_scores s
     JOIN topics t ON t.id = s.related_topic_id
     WHERE s.topic_id = ?
       AND s.overlap_count > 0
       AND t.hidden = 0
       AND t.display_suppressed = 0
       AND t.episode_support >= ?
     ORDER BY s.combined_score DESC, s.overlap_count DESC, t.name ASC
     LIMIT 5`
  ).bind(topicId, minEpisodeSupport).all<{ slug: string }>();

  if (related.results.length === 0) {
    related = await db.prepare(
      `SELECT t.slug FROM chunk_topics ct1
       JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
       JOIN topics t ON ct2.topic_id = t.id
       WHERE ct1.topic_id = ?
         AND t.hidden = 0
         AND t.display_suppressed = 0
       GROUP BY ct2.topic_id
       ORDER BY COUNT(*) DESC
       LIMIT 5`
    ).bind(topicId).all<{ slug: string }>();
  }

  const slugs = JSON.stringify(related.results.map(r => r.slug));
  await db.prepare(
    "UPDATE topics SET related_slugs = ? WHERE id = ?"
  ).bind(slugs, topicId).run();

  return { related_topics: related.results.length };
}

async function handleAssignNgram(db: D1Database, phrase: string) {
  const slug = slugify(phrase);
  if (!slug || slug.length < 3) return { topics_created: 0, chunk_links_inserted: 0 };

  await db.prepare(
    "INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, 'phrase')"
  ).bind(phrase, slug).run();

  const topic = await db.prepare(
    "SELECT id FROM topics WHERE slug = ?"
  ).bind(slug).first<{ id: number }>();
  if (!topic) return { topics_created: 0, chunk_links_inserted: 0 };

  const matchingChunks = await db.prepare(
    "SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ? ESCAPE '\\'"
  ).bind(`%${phrase}%`).all<{ id: number }>();

  const stmts = matchingChunks.results.map(c =>
    db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
      .bind(c.id, topic.id)
  );
  await batchExec(db, stmts);

  await db.prepare(
    "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = ?) WHERE id = ?"
  ).bind(topic.id, topic.id).run();

  return { topics_created: 1, chunk_links_inserted: matchingChunks.results.length };
}

async function handleExtractNgrams(db: D1Database, queue: Queue) {
  const count = await db.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>();
  if (!count || count.c < 10) return { phrases_dispatched: 0 };

  // Try PMI-based extraction first (uses chunk_words, no text loading needed)
  const chunkWordsCount = await db.prepare(
    "SELECT COUNT(*) as c FROM chunk_words"
  ).first<{ c: number }>();

  let phrases: string[] = [];

  if (chunkWordsCount && chunkWordsCount.c >= 20) {
    const pmiPhrases = await extractPMIPhrases(db, 3.0, 5, 100);
    phrases = pmiPhrases.map(p => p.phrase);
  } else {
    // Fall back to raw n-gram extraction from text
    const BATCH = 500;
    const allTexts: string[] = [];
    for (let offset = 0; offset < count.c; offset += BATCH) {
      const batch = await db.prepare(
        "SELECT content_plain FROM chunks LIMIT ? OFFSET ?"
      ).bind(BATCH, offset).all<{ content_plain: string }>();
      allTexts.push(...batch.results.map(c => c.content_plain));
    }
    const ngrams = extractCorpusNgrams(allTexts, 5, 3).slice(0, 100);
    phrases = ngrams.map(ng => ng.phrase);
  }

  // Dispatch each phrase assignment as a separate message
  if (phrases.length > 0) {
    const messages = phrases.map(phrase => ({
      body: { type: "assign-ngram" as const, phrase }
    }));
    for (let i = 0; i < messages.length; i += 25) {
      await queue.sendBatch(messages.slice(i, i + 25));
    }
  }

  // Note: kind='phrase' is set by extractAndStoreNgrams/PMI for discovered phrases only.
  // No auto-promote rule — only authoritative sources set kind.
  return { phrases_dispatched: phrases.length };
}

export async function handleEnrichBatch(db: D1Database, chunkIds: number[]) {
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
  await processChunkBatch(db, chunkRows, "naive", {
    phraseLexiconOverride: phraseLexicon,
    rebuildWordStats: false,
  });
  await rebuildWordStatsAggregates(db);
  return { chunks_processed: chunkRows.length };
}

function queueMessageContext(body: EnrichmentMessage): Record<string, string | number> {
  if (body.type === "compute-related" && body.topicId) return { topic_id: body.topicId };
  if (body.type === "assign-ngram" && body.phrase) return { phrase: body.phrase };
  if (body.type === "enrich-batch" && body.chunkIds) return { chunk_count: body.chunkIds.length };
  if (body.type === "llm-episode-enrich" && body.episodeId) return { episode_id: body.episodeId };
  return {};
}

export async function handleEnrichmentBatch(
  batch: MessageBatch<EnrichmentMessage>,
  env: Bindings
): Promise<void> {
  const messages = [...batch.messages];
  const concurrency = Math.min(5, messages.length);
  let index = 0;

  async function processOne(msg: Message<EnrichmentMessage>) {
    const startedAt = Date.now();
    const context = queueMessageContext(msg.body);
    try {
      let counts: Record<string, number> = {};
      if (msg.body.type === "compute-related" && msg.body.topicId) {
        counts = await handleComputeRelated(env.DB, msg.body.topicId);
      } else if (msg.body.type === "assign-ngram" && msg.body.phrase) {
        counts = await handleAssignNgram(env.DB, msg.body.phrase);
      } else if (msg.body.type === "extract-ngrams") {
        counts = await handleExtractNgrams(env.DB, env.ENRICHMENT_QUEUE);
      } else if (msg.body.type === "enrich-batch" && msg.body.chunkIds) {
        counts = await handleEnrichBatch(env.DB, msg.body.chunkIds);
      } else if (msg.body.type === "llm-episode-enrich" && msg.body.episodeId) {
        await enrichEpisodeIdsWithLlm(env, [msg.body.episodeId]);
        counts = { episodes_processed: 1 };
      }
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
      if (retryable) {
        msg.retry();
      } else {
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
