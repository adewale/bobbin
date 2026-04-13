import { slugify } from "../lib/slug";
import { formatDate } from "../lib/date";
import { countWords } from "../lib/text";
import { extractTopics, computeCorpusStats, type CorpusStats } from "../services/topic-extractor";
import { tokenizeForWordStats } from "../services/word-stats";
import { extractCorpusNgrams } from "../services/ngram-extractor";
import { isNoiseTopic } from "../services/topic-quality";
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

  // Compute corpus IDF stats for this batch (improves topic quality)
  const corpusStats = computeCorpusStats(chunks.map(c => c.content_plain));

  // Collect all topics — filter noise at insert time
  const uniqueTopics = new Map<string, { name: string; kind: string }>();
  const chunkTopicPairs: { chunkId: number; episodeId: number; topicSlug: string }[] = [];

  for (const chunk of chunks) {
    const topics = extractTopics(chunk.content_plain, 15, corpusStats);
    for (const topic of topics) {
      // Filter noise at insert time — entities always pass
      if (topic.kind !== "entity" && isNoiseTopic(topic.name)) continue;
      uniqueTopics.set(topic.slug, { name: topic.name, kind: topic.kind || "concept" });
      chunkTopicPairs.push({ chunkId: chunk.id, episodeId: chunk.episode_id, topicSlug: topic.slug });
    }
  }

  // Batch: insert unique topics
  const topicInserts = [...uniqueTopics.entries()].map(([slug, { name }]) =>
    db.prepare("INSERT OR IGNORE INTO topics (name, slug) VALUES (?, ?)").bind(name, slug)
  );
  await batchExec(db, topicInserts);

  // Set kind for entity topics (handles INSERT OR IGNORE conflict where entity exists with kind='concept')
  const entitySlugs = [...uniqueTopics.entries()].filter(([, v]) => v.kind === "entity").map(([slug]) => slug);
  if (entitySlugs.length > 0) {
    const entityUpdates = entitySlugs.map(slug =>
      db.prepare("UPDATE topics SET kind = 'entity' WHERE slug = ? AND kind != 'entity'").bind(slug)
    );
    await batchExec(db, entityUpdates);
  }

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

  return { chunksProcessed: chunks.length };
}

/**
 * Finalize enrichment: run once after all chunks are enriched.
 * Fast steps run inline. Slow steps (related_slugs, n-gram assignment)
 * are dispatched to a queue for parallel processing when a queue is available.
 */
export async function finalizeEnrichment(db: D1Database, queue?: Queue): Promise<void> {
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

  // Auto-merge split concepts based on co-occurrence
  await mergeCoOccurringTopics(db);

  // Corpus-level n-gram extraction: discover phrase topics
  // Load chunks in batches to avoid memory issues at scale
  const chunkCount = await db.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>();
  if (chunkCount && chunkCount.c >= 10) {
    const BATCH = 1000;
    const allTexts: string[] = [];
    for (let offset = 0; offset < chunkCount.c; offset += BATCH) {
      const batch = await db.prepare("SELECT content_plain FROM chunks LIMIT ? OFFSET ?").bind(BATCH, offset).all<{ content_plain: string }>();
      allTexts.push(...batch.results.map(c => c.content_plain));
    }

    const ngrams = extractCorpusNgrams(allTexts, 5, 3).slice(0, 100);

    if (queue && ngrams.length > 0) {
      // Dispatch n-gram assignments to queue for parallel processing
      const ngramMessages = ngrams.map(ng => ({ body: { type: "assign-ngram" as const, phrase: ng.phrase } }));
      for (let i = 0; i < ngramMessages.length; i += 25) {
        await queue.sendBatch(ngramMessages.slice(i, i + 25));
      }
    } else if (ngrams.length > 0) {
      // No queue — process inline (slower but works)
      await extractAndStoreNgrams(db);
    }

    // Set kind='phrase' for all multi-word topics with enough usage
    await db.prepare("UPDATE topics SET kind = 'phrase' WHERE name LIKE '% %' AND usage_count >= 5 AND kind = 'concept'").run();
  }

  // Precompute distinctiveness from word_stats
  await db.prepare(
    `UPDATE topics SET distinctiveness = COALESCE(
      (SELECT w.distinctiveness FROM word_stats w WHERE w.word = topics.name), 0
    )`
  ).run();

  // Precompute related_slugs — dispatch to queue or process inline
  const allTopics = await db.prepare(
    "SELECT id, slug FROM topics WHERE usage_count >= 3"
  ).all<{ id: number; slug: string }>();

  if (queue && allTopics.results.length > 0) {
    // Dispatch related_slugs computation to queue for parallel processing
    const relatedMessages = allTopics.results.map(t => ({ body: { type: "compute-related" as const, topicId: t.id } }));
    for (let i = 0; i < relatedMessages.length; i += 25) {
      await queue.sendBatch(relatedMessages.slice(i, i + 25));
    }
  } else {
    // No queue — process inline
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
      await db.prepare(
        "UPDATE topics SET related_slugs = ? WHERE id = ?"
      ).bind(slugs, topic.id).run();
    }
  }

  // === Self-healing cleanup steps ===

  // Issue 1: Validate entity assignments — remove false matches
  const entities = await db.prepare(
    "SELECT id, name FROM topics WHERE kind = 'entity' AND usage_count > 0"
  ).all<{ id: number; name: string }>();
  for (const entity of entities.results) {
    await db.prepare(
      `DELETE FROM chunk_topics WHERE topic_id = ? AND chunk_id NOT IN (
        SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ?
      )`
    ).bind(entity.id, `%${entity.name.toLowerCase()}%`).run();
  }

  // Issue 5: Remove chunk_topics for noise-word topics
  const noiseCandidates = await db.prepare(
    "SELECT id, name, kind FROM topics WHERE usage_count > 0"
  ).all<{ id: number; name: string; kind: string }>();
  const noiseIds = noiseCandidates.results
    .filter(t => t.kind !== "entity" && isNoiseTopic(t.name))
    .map(t => t.id);
  if (noiseIds.length > 0) {
    for (const id of noiseIds) {
      await db.prepare("DELETE FROM chunk_topics WHERE topic_id = ?").bind(id).run();
      await db.prepare("DELETE FROM episode_topics WHERE topic_id = ?").bind(id).run();
    }
  }

  // Recalculate usage counts after cleanup
  await db.prepare(
    "UPDATE topics SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = topics.id)"
  ).run();

  // Issue 3: Prune topics with usage <= 1 (single-occurrence noise)
  // Entities are exempt — even with 1 mention, curated entities should survive
  await db.prepare("DELETE FROM chunk_topics WHERE topic_id IN (SELECT id FROM topics WHERE usage_count <= 1 AND kind != 'entity')").run();
  await db.prepare("DELETE FROM episode_topics WHERE topic_id IN (SELECT id FROM topics WHERE usage_count <= 1 AND kind != 'entity')").run();
  await db.prepare("UPDATE topics SET usage_count = 0 WHERE usage_count <= 1 AND kind != 'entity'").run();
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
 * Discovers phrase topics (bigrams/trigrams) that appear frequently across chunks.
 * Creates topics with kind='phrase' and assigns them to chunks containing the phrase.
 */
async function extractAndStoreNgrams(db: D1Database) {
  // Get all chunk texts
  const allChunks = await db.prepare(
    "SELECT id, content_plain FROM chunks"
  ).all<{ id: number; content_plain: string }>();

  if (allChunks.results.length < 10) return; // not enough data for meaningful n-grams

  const texts = allChunks.results.map(c => c.content_plain);
  const ngrams = extractCorpusNgrams(texts, 5, 3); // min 5 occurrences, min 3 documents

  // Create phrase topics for discovered n-grams
  const topNgrams = ngrams.slice(0, 100); // limit to top 100
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

    // Find chunks containing this phrase and assign the topic
    const phrasePattern = `%${ng.phrase}%`;
    const matchingChunks = await db.prepare(
      "SELECT id FROM chunks WHERE LOWER(content_plain) LIKE ? ESCAPE '\\'"
    ).bind(phrasePattern).all<{ id: number }>();

    const stmts = matchingChunks.results.map(c =>
      db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)")
        .bind(c.id, topic.id)
    );
    await batchExec(db, stmts);

    // Update usage count
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
