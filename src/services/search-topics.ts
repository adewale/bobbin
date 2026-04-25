import type { ScoredResult } from "./search";

function normalizeTopicSlugs(topicSlugs: readonly string[]): string[] {
  return [...new Set(topicSlugs.map((slug) => slug.trim()).filter(Boolean))];
}

function topicChunkFilterSql(): string {
  return `SELECT ct.chunk_id
          FROM chunk_topics ct
          JOIN topics t ON ct.topic_id = t.id
          JOIN json_each(?) AS filter_topics ON t.slug = filter_topics.value
          WHERE t.hidden = 0 AND t.display_suppressed = 0
          GROUP BY ct.chunk_id
          HAVING COUNT(DISTINCT t.id) = ?`;
}

export function buildTopicChunkFilterClause(chunkColumn: string, topicSlugs: readonly string[]) {
  const normalizedTopicSlugs = normalizeTopicSlugs(topicSlugs);
  if (normalizedTopicSlugs.length === 0) {
    return { sql: "", binds: [] as unknown[] };
  }

  return {
    sql: `AND ${chunkColumn} IN (${topicChunkFilterSql()})`,
    binds: [JSON.stringify(normalizedTopicSlugs), normalizedTopicSlugs.length] as unknown[],
  };
}

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
    .prepare("SELECT id FROM topics WHERE (slug = ? OR LOWER(name) = ?) AND hidden = 0 AND display_suppressed = 0")
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
  const normalizedTopicSlugs = normalizeTopicSlugs(topicSlugs);
  if (normalizedTopicSlugs.length === 0) return [];

  const chunks = await db
    .prepare(topicChunkFilterSql())
    .bind(JSON.stringify(normalizedTopicSlugs), normalizedTopicSlugs.length)
    .all<{ chunk_id: number }>();

  return chunks.results.map((r) => r.chunk_id);
}
