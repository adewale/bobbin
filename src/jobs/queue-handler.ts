/**
 * Queue consumer for enrichment finalization.
 *
 * Handles two message types:
 * - "compute-related": compute related_slugs for a single topic
 * - "assign-ngram": create a phrase topic and assign to matching chunks
 */
import { slugify } from "../lib/slug";
import type { Bindings } from "../types";

export interface EnrichmentMessage {
  type: "compute-related" | "assign-ngram";
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
      }
      msg.ack();
    } catch (e) {
      console.error(`Queue message failed:`, e);
      msg.retry();
    }
  }
}
