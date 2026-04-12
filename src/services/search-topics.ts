import type { ScoredResult } from "./search";

/**
 * Apply a score boost to search results that are assigned to a topic
 * matching the query text. Chunks where the concept is thematically
 * central (assigned) get a +0.15 bonus over chunks that merely mention
 * the word in passing.
 */
export async function applyTopicBoost(
  db: D1Database,
  query: string,
  results: ScoredResult[]
): Promise<ScoredResult[]> {
  if (results.length === 0) return results;

  const lowerQuery = query.toLowerCase();

  // Check if the query matches a topic by slug or name
  const topicMatch = await db
    .prepare("SELECT id FROM topics WHERE slug = ? OR LOWER(name) = ?")
    .bind(lowerQuery, lowerQuery)
    .first<{ id: number }>();

  if (!topicMatch) return results;

  // Get all chunk IDs assigned to this topic
  const topicChunks = await db
    .prepare("SELECT chunk_id FROM chunk_topics WHERE topic_id = ?")
    .bind(topicMatch.id)
    .all<{ chunk_id: number }>();

  const boostedIds = new Set(topicChunks.results.map((r) => r.chunk_id));

  // Apply boost and re-sort
  const boosted = results.map((r) => ({
    ...r,
    score: boostedIds.has(r.id) ? r.score + 0.15 : r.score,
  }));

  boosted.sort((a, b) => b.score - a.score);
  return boosted;
}

/**
 * Resolve topic slugs to a set of chunk IDs that are assigned to ALL
 * of the specified topics (intersection). Used by the topic: search
 * operator to filter results.
 */
export async function applyTopicFilter(
  db: D1Database,
  topicSlugs: string[]
): Promise<number[]> {
  if (topicSlugs.length === 0) return [];

  // Resolve each slug to a topic ID
  const topicIds: number[] = [];
  for (const slug of topicSlugs) {
    const topic = await db
      .prepare("SELECT id FROM topics WHERE slug = ?")
      .bind(slug)
      .first<{ id: number }>();
    if (!topic) return []; // If any topic doesn't exist, no results
    topicIds.push(topic.id);
  }

  if (topicIds.length === 1) {
    // Simple case: single topic
    const chunks = await db
      .prepare("SELECT chunk_id FROM chunk_topics WHERE topic_id = ?")
      .bind(topicIds[0])
      .all<{ chunk_id: number }>();
    return chunks.results.map((r) => r.chunk_id);
  }

  // Intersection: chunks assigned to ALL specified topics
  const placeholders = topicIds.map(() => "?").join(",");
  const chunks = await db
    .prepare(
      `SELECT chunk_id FROM chunk_topics
       WHERE topic_id IN (${placeholders})
       GROUP BY chunk_id
       HAVING COUNT(DISTINCT topic_id) = ?`
    )
    .bind(...topicIds, topicIds.length)
    .all<{ chunk_id: number }>();

  return chunks.results.map((r) => r.chunk_id);
}
