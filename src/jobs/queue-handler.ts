/**
 * Queue consumer for enrichment finalization.
 *
 * Handles three message types:
 * - "compute-related": compute related_slugs for a single topic
 * - "assign-ngram": create a phrase topic and assign to matching chunks
 * - "extract-ngrams": load all chunk texts, extract corpus n-grams, and dispatch assign-ngram messages
 */
import { slugify } from "../lib/slug";
import { extractCorpusNgrams } from "../services/ngram-extractor";
import type { Bindings } from "../types";

export interface EnrichmentMessage {
  type: "compute-related" | "assign-ngram" | "extract-ngrams";
  // compute-related
  topicId?: number;
  // assign-ngram
  phrase?: string;
}

async function batchExec(db: D1Database, stmts: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
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
  // Load chunks in batches to avoid memory limits
  const count = await db.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>();
  if (!count || count.c < 10) return;

  const BATCH = 500;
  const allTexts: string[] = [];
  for (let offset = 0; offset < count.c; offset += BATCH) {
    const batch = await db.prepare(
      "SELECT content_plain FROM chunks LIMIT ? OFFSET ?"
    ).bind(BATCH, offset).all<{ content_plain: string }>();
    allTexts.push(...batch.results.map(c => c.content_plain));
  }

  const ngrams = extractCorpusNgrams(allTexts, 5, 3).slice(0, 100);

  // Dispatch each n-gram assignment as a separate message
  if (ngrams.length > 0) {
    const messages = ngrams.map(ng => ({
      body: { type: "assign-ngram" as const, phrase: ng.phrase }
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
      }
      msg.ack();
    } catch (e) {
      console.error(`Queue message failed:`, e);
      msg.retry();
    }
  }
}
