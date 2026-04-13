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
import { batchExec } from "../lib/db";
import { extractCorpusNgrams } from "../services/ngram-extractor";
import { extractPMIPhrases } from "../services/pmi-phrases";
import { extractTopics, type CorpusStats } from "../services/topic-extractor";
import { tokenizeForWordStats } from "../services/word-stats";
import { markChunksEnriched } from "../db/ingestion";
import type { Bindings } from "../types";

export interface EnrichmentMessage {
  type: "compute-related" | "assign-ngram" | "extract-ngrams" | "enrich-batch";
  // compute-related
  topicId?: number;
  // assign-ngram
  phrase?: string;
  // enrich-batch
  chunkIds?: number[];
}

async function handleComputeRelated(db: D1Database, topicId: number) {
  const related = await db.prepare(
    `SELECT t.slug FROM chunk_topics ct1
     JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
     JOIN topics t ON ct2.topic_id = t.id
     WHERE ct1.topic_id = ?
     GROUP BY ct2.topic_id
     ORDER BY COUNT(*) DESC
     LIMIT 5`
  ).bind(topicId).all<{ slug: string }>();

  const slugs = JSON.stringify(related.results.map(r => r.slug));
  await db.prepare(
    "UPDATE topics SET related_slugs = ? WHERE id = ?"
  ).bind(slugs, topicId).run();
}

async function handleAssignNgram(db: D1Database, phrase: string) {
  const slug = slugify(phrase);
  if (!slug || slug.length < 3) return;

  await db.prepare(
    "INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, 'phrase')"
  ).bind(phrase, slug).run();

  const topic = await db.prepare(
    "SELECT id FROM topics WHERE slug = ?"
  ).bind(slug).first<{ id: number }>();
  if (!topic) return;

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
}

async function handleExtractNgrams(db: D1Database, queue: Queue) {
  const count = await db.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>();
  if (!count || count.c < 10) return;

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

  // Set kind='phrase' for multi-word topics
  await db.prepare(
    "UPDATE topics SET kind = 'phrase' WHERE name LIKE '% %' AND usage_count >= 5 AND kind = 'concept'"
  ).run();
}

export async function handleEnrichBatch(db: D1Database, chunkIds: number[]) {
  if (!chunkIds.length) return;

  // Load the specific chunks by ID
  const placeholders = chunkIds.map(() => "?").join(",");
  const chunks = await db.prepare(
    `SELECT id, episode_id, content_plain FROM chunks WHERE id IN (${placeholders})`
  ).bind(...chunkIds).all<{ id: number; episode_id: number; content_plain: string }>();

  if (!chunks.results.length) return;

  // Load IDF from word_stats
  const idfData = await db.prepare(
    "SELECT word, doc_count FROM word_stats WHERE doc_count >= 2 LIMIT 10000"
  ).all<{ word: string; doc_count: number }>();
  const totalDocs = await db.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>();
  const corpusStats: CorpusStats = {
    totalChunks: totalDocs?.c || 1,
    docFreq: new Map(idfData.results.map((r) => [r.word, r.doc_count])),
  };

  // Extract topics for each chunk (same logic as enrichChunks)
  const uniqueTopics = new Map<string, { name: string; kind: string }>();
  const chunkTopicPairs: { chunkId: number; episodeId: number; topicSlug: string }[] = [];

  for (const chunk of chunks.results) {
    const topics = extractTopics(chunk.content_plain, 15, corpusStats);
    for (const topic of topics) {
      uniqueTopics.set(topic.slug, { name: topic.name, kind: topic.kind || "concept" });
      chunkTopicPairs.push({ chunkId: chunk.id, episodeId: chunk.episode_id, topicSlug: topic.slug });
    }
  }

  // Batch: insert unique topics
  const topicInserts = [...uniqueTopics.entries()].map(([slug, { name }]) =>
    db.prepare("INSERT OR IGNORE INTO topics (name, slug) VALUES (?, ?)").bind(name, slug)
  );
  await batchExec(db, topicInserts);

  // Set kind for entity topics
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
  const episodeIds = [...new Set(chunks.results.map((c) => c.episode_id))];
  const etStmts = episodeIds.flatMap((epId) =>
    chunks.results
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
  for (const chunk of chunks.results) {
    const wordCounts = tokenizeForWordStats(chunk.content_plain);
    for (const [word, count] of wordCounts) {
      wordStmts.push(
        db.prepare("INSERT OR REPLACE INTO chunk_words (chunk_id, word, count) VALUES (?, ?, ?)")
          .bind(chunk.id, word, count)
      );
    }
  }
  await batchExec(db, wordStmts);

  // Mark chunks as enriched
  await markChunksEnriched(db, chunks.results.map(c => c.id));
}

export async function handleEnrichmentBatch(
  batch: MessageBatch<EnrichmentMessage>,
  env: Bindings
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      if (msg.body.type === "compute-related" && msg.body.topicId) {
        await handleComputeRelated(env.DB, msg.body.topicId);
      } else if (msg.body.type === "assign-ngram" && msg.body.phrase) {
        await handleAssignNgram(env.DB, msg.body.phrase);
      } else if (msg.body.type === "extract-ngrams") {
        await handleExtractNgrams(env.DB, env.ENRICHMENT_QUEUE);
      } else if (msg.body.type === "enrich-batch" && msg.body.chunkIds) {
        await handleEnrichBatch(env.DB, msg.body.chunkIds);
      }
      msg.ack();
    } catch (e) {
      console.error(`Queue message failed:`, e);
      msg.retry();
    }
  }
}
