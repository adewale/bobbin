import { slugify } from "../lib/slug";
import { formatDate } from "../lib/date";
import { countWords } from "../lib/text";
import { batchExec } from "../lib/db";
import { extractTopics, computeCorpusStats, type CorpusStats } from "../services/topic-extractor";
import { tokenizeForWordStats } from "../services/word-stats";
import { extractCorpusNgrams } from "../services/ngram-extractor";
import { extractPMIPhrases } from "../services/pmi-phrases";
import { isNoiseTopic } from "../services/topic-quality";
import { generateEmbeddings } from "../services/embeddings";
import { getExistingDatesForSource, getSourceTag } from "../db/sources";
import { getUnenrichedChunks, markChunksEnriched, isEnrichmentDone } from "../db/ingestion";
import type { Bindings, ParsedEpisode } from "../types";

/** Current enrichment algorithm version. Bump to re-enrich all chunks.
 * v1: Initial TF-IDF extraction (maxTopics=15, no noise filter on heuristics)
 * v2: Quality improvements — maxTopics=10, noise filter on all sources,
 *     expanded NOISE_WORDS (+80 words), suffix heuristics, curly quote fix
 * v3: processChunkBatch deletes old chunk_topics before inserting new ones;
 *     finalization steps batched to stay under D1 CPU time limit
 */
export const CURRENT_ENRICHMENT_VERSION = 3;

/**
 * Phase 1: Fast insert — episodes and chunks only.
 * No topics, no word stats, no embeddings. Designed for the cron path.
 */
export async function ingestEpisodesOnly(
  db: D1Database,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<{ episodesAdded: number; chunksAdded: number }> {
  let episodesAdded = 0;
  let chunksAdded = 0;

  const existingDates = await getExistingDatesForSource(db, sourceId);
  const sourceTag = await getSourceTag(db, sourceId);

  for (const episode of episodes) {
    const dateStr = formatDate(episode.parsedDate);
    if (existingDates.has(dateStr)) continue;

    const episodeSlug = `${dateStr}-${sourceTag}`;
    const episodeResult = await db.prepare(
      `INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sourceId, episodeSlug, episode.title, dateStr,
        episode.parsedDate.getUTCFullYear(),
        episode.parsedDate.getUTCMonth() + 1,
        episode.parsedDate.getUTCDate(),
        episode.chunks.length, episode.format
      )
      .run();

    const episodeId = episodeResult.meta.last_row_id;
    episodesAdded++;

    const chunkInserts: D1PreparedStatement[] = [];
    for (const chunk of episode.chunks) {
      const baseSlug = slugify(chunk.title) || `chunk-${chunk.position}`;
      const chunkSlug = `${baseSlug}-${episodeSlug}-${chunk.position}`;
      const wordCount = countWords(chunk.contentPlain);
      const vectorId = `chunk-${episodeSlug}-${chunk.position}`;

      chunkInserts.push(
        db.prepare(
          `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count, vector_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(episodeId, chunkSlug, chunk.title, chunk.content, chunk.contentPlain, chunk.position, wordCount, vectorId)
      );
    }

    await batchExec(db, chunkInserts);
    chunksAdded += episode.chunks.length;
  }

  return { episodesAdded, chunksAdded };
}

/**
 * Shared core: process a batch of chunks — extract topics, insert to DB.
 * Used by both enrichChunks (API path) and handleEnrichBatch (queue path).
 * Single source of truth for topic extraction logic.
 */
export async function processChunkBatch(
  db: D1Database,
  chunks: { id: number; episode_id: number; content_plain: string }[]
): Promise<void> {
  if (!chunks.length) return;

  // Load corpus-wide IDF from word_stats (one D1 query, no CPU tokenization)
  let corpusStats: CorpusStats;
  const wsCount = await db.prepare("SELECT COUNT(*) as c FROM word_stats").first<{ c: number }>();
  if (wsCount && wsCount.c >= 100) {
    const idfData = await db.prepare(
      "SELECT word, doc_count FROM word_stats WHERE doc_count >= 2 LIMIT 10000"
    ).all<{ word: string; doc_count: number }>();
    const totalDocs = await db.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>();
    corpusStats = {
      totalChunks: totalDocs?.c || 1,
      docFreq: new Map(idfData.results.map(r => [r.word, r.doc_count])),
    };
  } else {
    corpusStats = computeCorpusStats(chunks.map(c => c.content_plain));
  }

  // Extract topics (noise filtered inside extractTopics)
  const uniqueTopics = new Map<string, { name: string; kind: string }>();
  const chunkTopicPairs: { chunkId: number; episodeId: number; topicSlug: string }[] = [];

  for (const chunk of chunks) {
    const topics = extractTopics(chunk.content_plain, 10, corpusStats);
    for (const topic of topics) {
      uniqueTopics.set(topic.slug, { name: topic.name, kind: topic.kind || "concept" });
      chunkTopicPairs.push({ chunkId: chunk.id, episodeId: chunk.episode_id, topicSlug: topic.slug });
    }
  }

  // Insert topics
  const topicInserts = [...uniqueTopics.entries()].map(([slug, { name }]) =>
    db.prepare("INSERT OR IGNORE INTO topics (name, slug) VALUES (?, ?)").bind(name, slug)
  );
  await batchExec(db, topicInserts);

  // Set kind='entity' ONLY for curated known entities (not heuristic)
  const entitySlugs = [...uniqueTopics.entries()].filter(([, v]) => v.kind === "entity").map(([slug]) => slug);
  if (entitySlugs.length > 0) {
    const entityUpdates = entitySlugs.map(slug =>
      db.prepare("UPDATE topics SET kind = 'entity' WHERE slug = ? AND kind != 'entity'").bind(slug)
    );
    await batchExec(db, entityUpdates);
  }

  // Delete old chunk_topics for this batch (clean slate on re-enrichment)
  const chunkIds = chunks.map(c => c.id);
  const BATCH_DEL = 90;
  for (let i = 0; i < chunkIds.length; i += BATCH_DEL) {
    const batch = chunkIds.slice(i, i + BATCH_DEL);
    const ph = batch.map(() => "?").join(",");
    await db.prepare(`DELETE FROM chunk_topics WHERE chunk_id IN (${ph})`).bind(...batch).run();
  }

  // Insert chunk_topics
  const ctStmts: D1PreparedStatement[] = [];
  for (const { chunkId, topicSlug } of chunkTopicPairs) {
    ctStmts.push(
      db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) SELECT ?, id FROM topics WHERE slug = ?")
        .bind(chunkId, topicSlug)
    );
  }
  await batchExec(db, ctStmts);

  // Delete old episode_topics then rebuild
  const episodeIds = [...new Set(chunks.map((c) => c.episode_id))];
  for (const epId of episodeIds) {
    await db.prepare("DELETE FROM episode_topics WHERE episode_id = ?").bind(epId).run();
  }
  const etStmts = episodeIds.flatMap((epId) =>
    chunks
      .filter((c) => c.episode_id === epId)
      .map((c) =>
        db.prepare(
          "INSERT OR IGNORE INTO episode_topics (episode_id, topic_id) SELECT ?, topic_id FROM chunk_topics WHERE chunk_id = ?"
        ).bind(epId, c.id)
      )
  );
  await batchExec(db, etStmts);

  // Insert chunk_words
  const wordStmts: D1PreparedStatement[] = [];
  for (const chunk of chunks) {
    const wordCounts = tokenizeForWordStats(chunk.content_plain);
    for (const [word, count] of wordCounts) {
      wordStmts.push(
        db.prepare("INSERT OR REPLACE INTO chunk_words (chunk_id, word, count) VALUES (?, ?, ?)")
          .bind(chunk.id, word, count)
      );
    }
  }
  await batchExec(db, wordStmts);

  // Mark enriched
  await markChunksEnriched(db, chunks.map(c => c.id));
}

/**
 * Phase 2: Enrich a batch of chunks that don't have topics yet.
 * Adds topics, chunk_topics, episode_topics, chunk_words, and rebuilds word_stats.
 * Call repeatedly until isEnrichmentComplete() returns true.
 */
export async function enrichChunks(
  db: D1Database,
  batchSize: number = 200
): Promise<{ chunksProcessed: number }> {
  const chunks = await getUnenrichedChunks(db, batchSize);
  if (!chunks.length) return { chunksProcessed: 0 };

  await processChunkBatch(db, chunks);

  return { chunksProcessed: chunks.length };
}

/**
 * Finalize enrichment: run once after all chunks are enriched.
 * Fast steps run inline. Slow steps (related_slugs, n-gram assignment)
 * are dispatched to a queue for parallel processing when a queue is available.
 */
export interface FinalizeStep {
  name: string;
  duration_ms: number;
  status: "ok" | "error";
  error?: string;
  detail?: string;
}

export interface FinalizeResult {
  usage_recalculated: boolean;
  word_stats_rebuilt: boolean;
  ngram_dispatched: boolean;
  related_slugs_method: "batch_sql" | "queue" | "inline" | "skipped";
  noise_removed: number;
  pruned: number;
  steps: FinalizeStep[];
  total_ms: number;
}

async function runStep(
  name: string,
  steps: FinalizeStep[],
  fn: () => Promise<string | void>
): Promise<boolean> {
  const start = Date.now();
  try {
    const detail = await fn();
    steps.push({
      name,
      duration_ms: Date.now() - start,
      status: "ok",
      ...(detail ? { detail } : {}),
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({
      name,
      duration_ms: Date.now() - start,
      status: "error",
      error: msg.substring(0, 500),
    });
    // Don't re-throw — continue to next step so we can see ALL failures
    return false;
  }
}

export async function finalizeEnrichment(db: D1Database, queue?: Queue): Promise<FinalizeResult> {
  const totalStart = Date.now();
  const steps: FinalizeStep[] = [];
  const result: FinalizeResult = {
    usage_recalculated: false,
    word_stats_rebuilt: false,
    ngram_dispatched: false,
    related_slugs_method: "skipped",
    noise_removed: 0,
    pruned: 0,
    steps,
    total_ms: 0,
  };

  // Step 1: Recalculate topic usage counts (batched to stay under D1 CPU limit)
  await runStep("usage_recount", steps, async () => {
    const topicCount = await db.prepare("SELECT MAX(id) as m FROM topics").first<{ m: number }>();
    const maxId = topicCount?.m || 0;
    const BATCH = 1000;
    for (let start = 0; start <= maxId; start += BATCH) {
      await db.prepare(
        "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = topics.id) WHERE id > ? AND id <= ?"
      ).bind(start, start + BATCH).run();
    }
    result.usage_recalculated = true;
    return `${maxId} topics recounted in ${Math.ceil(maxId / BATCH)} batches`;
  });

  // Step 2: Rebuild word_stats (split into separate queries to stay under CPU limit)
  await runStep("word_stats_rebuild", steps, async () => {
    // Step 2a: Remove orphaned word_stats entries
    await db.prepare(
      "DELETE FROM word_stats WHERE word NOT IN (SELECT DISTINCT word FROM chunk_words)"
    ).run();
    // Step 2b: Upsert word_stats from chunk_words
    await db.prepare(
      `INSERT INTO word_stats (word, total_count, doc_count, updated_at)
       SELECT word, SUM(count), COUNT(DISTINCT chunk_id), datetime('now')
       FROM chunk_words GROUP BY word
       ON CONFLICT(word) DO UPDATE SET
         total_count = excluded.total_count,
         doc_count = excluded.doc_count,
         updated_at = excluded.updated_at`
    ).run();
    result.word_stats_rebuilt = true;
  });

  // Step 3: Precompute reach (batched)
  await runStep("reach_precompute", steps, async () => {
    const maxChunk = await db.prepare("SELECT MAX(id) as m FROM chunks").first<{ m: number }>();
    const maxId = maxChunk?.m || 0;
    const BATCH = 1000;
    for (let start = 0; start <= maxId; start += BATCH) {
      await db.prepare(
        `UPDATE chunks SET reach = (
           SELECT COALESCE(SUM(t.usage_count), 0)
           FROM chunk_topics ct JOIN topics t ON ct.topic_id = t.id
           WHERE ct.chunk_id = chunks.id
         ) WHERE id > ? AND id <= ? AND id IN (SELECT chunk_id FROM chunk_topics)`
      ).bind(start, start + BATCH).run();
    }
  });

  // Step 4: Auto-merge split concepts
  await runStep("merge_cooccurring", steps, async () => {
    await mergeCoOccurringTopics(db);
  });

  // Step 5: N-gram extraction
  await runStep("ngram_extraction", steps, async () => {
    if (queue) {
      await queue.send({ type: "extract-ngrams" });
      result.ngram_dispatched = true;
      return "dispatched to queue";
    } else {
      await extractAndStoreNgrams(db);
      result.ngram_dispatched = true;
      return "inline";
    }
  });

  // Step 6: Deduplicate phrase pairs (BATCHED — not individual queries)
  await runStep("phrase_dedup", steps, async () => {
    // Only check topics that actually have usage — skip the 10,000+ dead topics
    const phrasePairs = await db.prepare(
      `SELECT t1.id as keep_id, t1.name as keep_name, t2.id as dupe_id, t2.name as dupe_name
       FROM topics t1
       JOIN topics t2 ON (
         t2.name = t1.name || 's' OR
         t2.name = t1.name || 'es' OR
         t1.name = t2.name || 's' OR
         t1.name = t2.name || 'es' OR
         t2.name = REPLACE(t1.name, '''s ', ' ') OR
         t1.name = REPLACE(t2.name, '''s ', ' ')
       )
       WHERE t1.id < t2.id AND t1.usage_count >= t2.usage_count
         AND t1.usage_count > 0 AND t2.usage_count > 0`
    ).all();

    if (phrasePairs.results.length > 0) {
      // Batch the dedup operations instead of individual queries per pair
      const stmts: D1PreparedStatement[] = [];
      for (const pair of phrasePairs.results as any[]) {
        stmts.push(
          db.prepare("UPDATE OR IGNORE chunk_topics SET topic_id = ? WHERE topic_id = ?")
            .bind(pair.keep_id, pair.dupe_id),
          db.prepare("DELETE FROM chunk_topics WHERE topic_id = ?").bind(pair.dupe_id),
          db.prepare("DELETE FROM episode_topics WHERE topic_id = ?").bind(pair.dupe_id),
          db.prepare("UPDATE topics SET usage_count = 0 WHERE id = ?").bind(pair.dupe_id),
        );
      }
      await batchExec(db, stmts);
    }
    return `${phrasePairs.results.length} pairs merged`;
  });

  // Step 7: Precompute distinctiveness (batched)
  await runStep("distinctiveness", steps, async () => {
    const topicCount = await db.prepare("SELECT MAX(id) as m FROM topics").first<{ m: number }>();
    const maxId = topicCount?.m || 0;
    const BATCH = 1000;
    for (let start = 0; start <= maxId; start += BATCH) {
      await db.prepare(
        `UPDATE topics SET distinctiveness = COALESCE(
          (SELECT w.distinctiveness FROM word_stats w WHERE w.word = topics.name), 0
        ) WHERE id > ? AND id <= ?`
      ).bind(start, start + BATCH).run();
    }
  });

  // Step 8: Precompute related_slugs
  await runStep("related_slugs", steps, async () => {
    try {
      await db.prepare(`
        UPDATE topics SET related_slugs = (
          SELECT '[' || GROUP_CONCAT('"' || t2.slug || '"') || ']'
          FROM (
            SELECT t.slug, COUNT(*) as cnt
            FROM chunk_topics ct1
            JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
            JOIN topics t ON ct2.topic_id = t.id
            WHERE ct1.topic_id = topics.id
            GROUP BY ct2.topic_id
            ORDER BY cnt DESC
            LIMIT 5
          ) t2
        )
        WHERE usage_count >= 5
      `).run();
      result.related_slugs_method = "batch_sql";
      return "batch_sql";
    } catch {
      // Batch too heavy — dispatch to queue or batch inline
      if (queue) {
        const topics = await db.prepare("SELECT id FROM topics WHERE usage_count >= 5").all<{ id: number }>();
        const messages = topics.results.map(t => ({ body: { type: "compute-related" as const, topicId: t.id } }));
        for (let i = 0; i < messages.length; i += 25) {
          await queue.sendBatch(messages.slice(i, i + 25));
        }
        result.related_slugs_method = "queue";
        return `queue (${topics.results.length} topics)`;
      } else {
        // Inline N+1 fallback — batch the UPDATE writes
        const allTopics = await db.prepare(
          "SELECT id, slug FROM topics WHERE usage_count >= 5"
        ).all<{ id: number; slug: string }>();
        const updateStmts: D1PreparedStatement[] = [];
        for (const topic of allTopics.results) {
          const related = await db.prepare(
            `SELECT t.slug FROM chunk_topics ct1
             JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
             JOIN topics t ON ct2.topic_id = t.id
             WHERE ct1.topic_id = ?
             GROUP BY ct2.topic_id
             ORDER BY COUNT(*) DESC
             LIMIT 5`
          ).bind(topic.id).all<{ slug: string }>();

          const slugs = JSON.stringify(related.results.map(r => r.slug));
          updateStmts.push(
            db.prepare("UPDATE topics SET related_slugs = ? WHERE id = ?").bind(slugs, topic.id)
          );
        }
        await batchExec(db, updateStmts);
        result.related_slugs_method = "inline";
        return `inline (${allTopics.results.length} topics)`;
      }
    }
  });

  // Step 9: Validate entity assignments (BATCHED)
  await runStep("entity_validation", steps, async () => {
    const entities = await db.prepare(
      "SELECT id, name FROM topics WHERE kind = 'entity' AND usage_count > 0"
    ).all<{ id: number; name: string }>();

    const stmts: D1PreparedStatement[] = [];
    for (const entity of entities.results) {
      stmts.push(
        db.prepare(
          `DELETE FROM chunk_topics WHERE topic_id = ? AND chunk_id NOT IN (
            SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ?
          )`
        ).bind(entity.id, `%${entity.name.toLowerCase()}%`)
      );
    }
    if (stmts.length > 0) {
      await batchExec(db, stmts);
    }
    return `${entities.results.length} entities validated`;
  });

  // Step 10: Remove noise-word topics (BATCHED — was O(n) individual DELETEs)
  await runStep("noise_cleanup", steps, async () => {
    const noiseCandidates = await db.prepare(
      "SELECT id, name, kind FROM topics WHERE usage_count > 0"
    ).all<{ id: number; name: string; kind: string }>();
    const noiseIds = noiseCandidates.results
      .filter(t => t.kind !== "entity" && isNoiseTopic(t.name))
      .map(t => t.id);
    result.noise_removed = noiseIds.length;

    if (noiseIds.length > 0) {
      // Batch DELETE using IN clauses (max 90 per batch for SQLite variable limit)
      const BATCH = 90;
      for (let i = 0; i < noiseIds.length; i += BATCH) {
        const batch = noiseIds.slice(i, i + BATCH);
        const placeholders = batch.map(() => "?").join(",");
        await db.batch([
          db.prepare(`DELETE FROM chunk_topics WHERE topic_id IN (${placeholders})`).bind(...batch),
          db.prepare(`DELETE FROM episode_topics WHERE topic_id IN (${placeholders})`).bind(...batch),
        ]);
      }
    }
    return `${noiseIds.length} noise topics cleaned`;
  });

  // Step 11: Recalculate usage counts after cleanup (batched)
  await runStep("usage_recount_final", steps, async () => {
    const topicCount = await db.prepare("SELECT MAX(id) as m FROM topics").first<{ m: number }>();
    const maxId = topicCount?.m || 0;
    const BATCH = 1000;
    for (let start = 0; start <= maxId; start += BATCH) {
      await db.prepare(
        "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = topics.id) WHERE id > ? AND id <= ?"
      ).bind(start, start + BATCH).run();
    }
  });

  // Step 12: Prune low-usage topics (entities exempt, batched)
  await runStep("prune_low_usage", steps, async () => {
    const toPrune = await db.prepare(
      "SELECT id FROM topics WHERE usage_count <= 1 AND kind != 'entity'"
    ).all<{ id: number }>();
    result.pruned = toPrune.results.length;

    const ids = toPrune.results.map(t => t.id);
    const BATCH = 90;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const ph = batch.map(() => "?").join(",");
      await db.batch([
        db.prepare(`DELETE FROM chunk_topics WHERE topic_id IN (${ph})`).bind(...batch),
        db.prepare(`DELETE FROM episode_topics WHERE topic_id IN (${ph})`).bind(...batch),
        db.prepare(`UPDATE topics SET usage_count = 0 WHERE id IN (${ph})`).bind(...batch),
      ]);
    }
    return `${result.pruned} topics pruned in ${Math.ceil(ids.length / BATCH)} batches`;
  });

  result.total_ms = Date.now() - totalStart;
  return result;
}

/**
 * Enrich all unenriched chunks within a time budget.
 * Loops internally — no need for the caller to loop.
 */
export async function enrichAllChunks(db: D1Database, batchSize = 100, maxMs = 25000): Promise<number> {
  let total = 0;
  let lastProcessed = -1;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const result = await enrichChunks(db, batchSize);
    if (result.chunksProcessed === 0) break;
    // Prevent infinite loop: if we processed the same count twice, some chunks can't be enriched
    if (result.chunksProcessed === lastProcessed) break;
    lastProcessed = result.chunksProcessed;
    total += result.chunksProcessed;
  }
  return total;
}

/**
 * Auto-merge split concepts based on co-occurrence.
 */
async function mergeCoOccurringTopics(db: D1Database) {
  const mergeRules = [
    { parts: ["prompt", "injection"], merged: "prompt injection" },
    { parts: ["cognitive", "labor"], merged: "cognitive labor" },
    { parts: ["vibe", "coding"], merged: "vibe coding" },
    { parts: ["agent", "swarm"], merged: "agent swarm" },
    { parts: ["tech", "industry"], merged: "tech industry" },
  ];

  for (const rule of mergeRules) {
    const mergedSlug = rule.merged.replace(/\s+/g, "-").toLowerCase();

    const partIds: number[] = [];
    for (const part of rule.parts) {
      const t = await db.prepare("SELECT id FROM topics WHERE slug = ?").bind(part).first<{ id: number }>();
      if (t) partIds.push(t.id);
    }
    if (partIds.length !== rule.parts.length) continue;

    await db.prepare(
      "INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, 'phrase')"
    ).bind(rule.merged, mergedSlug).run();

    const mergedTopic = await db.prepare(
      "SELECT id FROM topics WHERE slug = ?"
    ).bind(mergedSlug).first<{ id: number }>();
    if (!mergedTopic) continue;

    const placeholders = partIds.map(() => "?").join(",");
    const sharedChunks = await db.prepare(
      `SELECT chunk_id FROM chunk_topics
       WHERE topic_id IN (${placeholders})
       GROUP BY chunk_id
       HAVING COUNT(DISTINCT topic_id) = ?`
    ).bind(...partIds, partIds.length).all<{ chunk_id: number }>();

    const stmts = sharedChunks.results.map(r =>
      db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
        .bind(r.chunk_id, mergedTopic.id)
    );
    await batchExec(db, stmts);

    await db.prepare(
      "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = ?) WHERE id = ?"
    ).bind(mergedTopic.id, mergedTopic.id).run();
  }
}

/**
 * Corpus-level n-gram extraction.
 * Uses PMI (Pointwise Mutual Information) from chunk_words when available,
 * falling back to raw bigram counting otherwise.
 * Creates topics with kind='phrase' and assigns them to chunks containing the phrase.
 */
async function extractAndStoreNgrams(db: D1Database) {
  // Check if chunk_words has enough data for PMI
  const chunkWordsCount = await db.prepare(
    "SELECT COUNT(*) as c FROM chunk_words"
  ).first<{ c: number }>();

  if (chunkWordsCount && chunkWordsCount.c >= 20) {
    // Use PMI-based extraction from chunk_words
    await extractAndStoreNgramsPMI(db);
  } else {
    // Fall back to raw n-gram extraction
    await extractAndStoreNgramsRaw(db);
  }
}

/**
 * PMI-based phrase extraction from chunk_words.
 * Replaces raw bigram counting with statistical significance testing.
 */
async function extractAndStoreNgramsPMI(db: D1Database) {
  const pmiPhrases = await extractPMIPhrases(db, 3.0, 5, 100);

  for (const p of pmiPhrases) {
    const slug = slugify(p.phrase);
    if (!slug || slug.length < 3) continue;

    await db.prepare(
      "INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, 'phrase')"
    ).bind(p.phrase, slug).run();

    const topic = await db.prepare(
      "SELECT id FROM topics WHERE slug = ?"
    ).bind(slug).first<{ id: number }>();
    if (!topic) continue;

    // Find chunks containing this phrase and assign the topic
    const phrasePattern = `%${p.phrase}%`;
    const matchingChunks = await db.prepare(
      "SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ? ESCAPE '\\'"
    ).bind(phrasePattern).all<{ id: number }>();

    const stmts = matchingChunks.results.map(c =>
      db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
        .bind(c.id, topic.id)
    );
    await batchExec(db, stmts);

    await db.prepare(
      "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = ?) WHERE id = ?"
    ).bind(topic.id, topic.id).run();
  }
}

/**
 * Raw n-gram extraction fallback (used when chunk_words is sparse).
 */
async function extractAndStoreNgramsRaw(db: D1Database) {
  const allChunks = await db.prepare(
    "SELECT id, content_plain FROM chunks"
  ).all<{ id: number; content_plain: string }>();

  if (allChunks.results.length < 10) return;

  const texts = allChunks.results.map(c => c.content_plain);
  const ngrams = extractCorpusNgrams(texts, 5, 3);

  const topNgrams = ngrams.slice(0, 100);
  for (const ng of topNgrams) {
    const slug = slugify(ng.phrase);
    if (!slug || slug.length < 3) continue;

    await db.prepare(
      "INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, 'phrase')"
    ).bind(ng.phrase, slug).run();

    const topic = await db.prepare(
      "SELECT id FROM topics WHERE slug = ?"
    ).bind(slug).first<{ id: number }>();
    if (!topic) continue;

    const phrasePattern = `%${ng.phrase}%`;
    const matchingChunks = await db.prepare(
      "SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ? ESCAPE '\\'"
    ).bind(phrasePattern).all<{ id: number }>();

    const stmts = matchingChunks.results.map(c =>
      db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
        .bind(c.id, topic.id)
    );
    await batchExec(db, stmts);

    await db.prepare(
      "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = ?) WHERE id = ?"
    ).bind(topic.id, topic.id).run();
  }
}

/**
 * Check if all chunks have been enriched (have topics).
 */
export async function isEnrichmentComplete(db: D1Database): Promise<boolean> {
  return isEnrichmentDone(db);
}

/**
 * Legacy: full pipeline (used by /api/ingest for manual ingestion).
 * Calls Phase 1 + Phase 2 in sequence.
 */
export async function ingestParsedEpisodes(
  env: Bindings,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<{ episodesAdded: number; chunksAdded: number }> {
  const result = await ingestEpisodesOnly(env.DB, sourceId, episodes);

  if (result.chunksAdded > 0) {
    await enrichChunks(env.DB, 10000);
    await finalizeEnrichment(env.DB, env.ENRICHMENT_QUEUE);

    // Embeddings (optional, may fail)
    try {
      if (env.AI && env.VECTORIZE) {
        const unembed = await env.DB.prepare(
          "SELECT id, content_plain, vector_id FROM chunks WHERE vector_id IS NOT NULL LIMIT 100"
        ).all();
        if (unembed.results.length > 0) {
          const texts = (unembed.results as any[]).map((c) => c.content_plain);
          const embeddings = await generateEmbeddings(env.AI, texts);
          const vectors = (unembed.results as any[]).map((c, i) => ({
            id: c.vector_id,
            values: embeddings[i],
            metadata: { chunkId: c.id },
          }));
          await env.VECTORIZE.upsert(vectors);
        }
      }
    } catch (e) {
      console.error("Embedding error:", e);
    }
  }

  return result;
}
