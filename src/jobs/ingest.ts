import { slugify } from "../lib/slug";
import { formatDate } from "../lib/date";
import { countWords } from "../lib/text";
import { extractTopics } from "../services/topic-extractor";
import { tokenizeForWordStats } from "../services/word-stats";
import { generateEmbeddings } from "../services/embeddings";
import { getExistingDatesForSource, getSourceTag } from "../db/sources";
import { getUnenrichedChunks, isEnrichmentDone } from "../db/ingestion";
import type { Bindings, ParsedEpisode } from "../types";

async function batchExec(db: D1Database, stmts: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}

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
 * Phase 2: Enrich a batch of chunks that don't have topics yet.
 * Adds topics, chunk_topics, episode_topics, chunk_words, and rebuilds word_stats.
 * Call repeatedly until isEnrichmentComplete() returns true.
 */
export async function enrichChunks(
  db: D1Database,
  batchSize: number = 50
): Promise<{ chunksProcessed: number }> {
  const chunks = await getUnenrichedChunks(db, batchSize);
  if (!chunks.length) return { chunksProcessed: 0 };

  // Collect all topics
  const uniqueTopics = new Map<string, string>();
  const chunkTopicPairs: { chunkId: number; episodeId: number; topicSlug: string }[] = [];

  for (const chunk of chunks) {
    const topics = extractTopics(chunk.content_plain);
    for (const topic of topics) {
      uniqueTopics.set(topic.slug, topic.name);
      chunkTopicPairs.push({ chunkId: chunk.id, episodeId: chunk.episode_id, topicSlug: topic.slug });
    }
  }

  // Batch: insert unique topics
  const topicInserts = [...uniqueTopics.entries()].map(([slug, name]) =>
    db.prepare("INSERT OR IGNORE INTO topics (name, slug) VALUES (?, ?)").bind(name, slug)
  );
  await batchExec(db, topicInserts);

  // Batch: chunk_topics
  const ctStmts: D1PreparedStatement[] = [];
  for (const { chunkId, topicSlug } of chunkTopicPairs) {
    ctStmts.push(
      db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) SELECT ?, id FROM topics WHERE slug = ?")
        .bind(chunkId, topicSlug)
    );
  }
  await batchExec(db, ctStmts);

  // Batch: episode_topics
  const episodeIds = [...new Set(chunks.map((c) => c.episode_id))];
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

  // Batch: chunk_words
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

  // Recalculate topic usage counts from actual chunk_topics
  await db.prepare(
    "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = topics.id)"
  ).run();

  // Rebuild word_stats (incremental: preserves distinctiveness and in_baseline columns)
  await db.batch([
    db.prepare("DELETE FROM word_stats WHERE word NOT IN (SELECT DISTINCT word FROM chunk_words)"),
    db.prepare(
      `INSERT INTO word_stats (word, total_count, doc_count, updated_at)
       SELECT word, SUM(count), COUNT(DISTINCT chunk_id), datetime('now')
       FROM chunk_words GROUP BY word
       ON CONFLICT(word) DO UPDATE SET
         total_count = excluded.total_count,
         doc_count = excluded.doc_count,
         updated_at = excluded.updated_at`
    ),
  ]);

  // Precompute reach for enriched chunks
  await db.prepare(
    `UPDATE chunks SET reach = (
       SELECT COALESCE(SUM(t.usage_count), 0)
       FROM chunk_topics ct JOIN topics t ON ct.topic_id = t.id
       WHERE ct.chunk_id = chunks.id
     ) WHERE id IN (SELECT chunk_id FROM chunk_topics)`
  ).run();

  return { chunksProcessed: chunks.length };
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
