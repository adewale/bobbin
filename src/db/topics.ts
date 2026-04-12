import type { TopicRow } from "../types";

export async function getTopTopics(db: D1Database, limit: number): Promise<TopicRow[]> {
  const result = await db.prepare(
    "SELECT * FROM topics WHERE usage_count > 0 ORDER BY usage_count DESC LIMIT ?"
  ).bind(limit).all<TopicRow>();
  return result.results;
}

export async function getFilteredTopics(db: D1Database, minUsage: number, limit: number): Promise<TopicRow[]> {
  const result = await db.prepare(
    "SELECT * FROM topics WHERE usage_count >= ? ORDER BY usage_count DESC LIMIT ?"
  ).bind(minUsage, limit).all<TopicRow>();
  return result.results;
}

export async function getTopicBySlug(db: D1Database, slug: string): Promise<TopicRow | null> {
  return await db.prepare("SELECT * FROM topics WHERE slug = ?")
    .bind(slug).first<TopicRow>();
}

export async function getTopicChunkCount(db: D1Database, topicId: number): Promise<number> {
  const result = await db.prepare(
    "SELECT COUNT(*) as count FROM chunk_topics WHERE topic_id = ?"
  ).bind(topicId).first<{ count: number }>();
  return result?.count || 0;
}

export async function getTopicChunks(db: D1Database, topicId: number, limit: number, offset: number) {
  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id = ?
     ORDER BY e.published_date DESC
     LIMIT ? OFFSET ?`
  ).bind(topicId, limit, offset).all();
  return result.results;
}

export async function getTopicSparkline(db: D1Database, topicId: number) {
  const result = await db.prepare(
    `SELECT e.published_date, COUNT(ct.chunk_id) as count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id = ?
     GROUP BY e.id
     ORDER BY e.published_date ASC`
  ).bind(topicId).all();
  return result.results as any[];
}

export async function getTopicDiffChunks(db: D1Database, topicId: number) {
  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id = ?
     ORDER BY e.published_date ASC`
  ).bind(topicId).all();
  return result.results as any[];
}

export async function getTopicFeedChunks(db: D1Database, topicId: number, limit = 50) {
  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.published_date
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id = ?
     ORDER BY e.published_date DESC
     LIMIT ?`
  ).bind(topicId, limit).all();
  return result.results as any[];
}

export async function getTopicEpisodes(db: D1Database, topicId: number) {
  const result = await db.prepare(
    `SELECT e.*, COUNT(ct.chunk_id) as topic_chunk_count
     FROM episodes e
     JOIN episode_topics et ON e.id = et.episode_id
     JOIN chunk_topics ct ON ct.topic_id = et.topic_id AND ct.topic_id = ?
     JOIN chunks c ON c.id = ct.chunk_id AND c.episode_id = e.id
     WHERE et.topic_id = ?
     GROUP BY e.id
     ORDER BY e.published_date ASC`
  ).bind(topicId, topicId).all();
  return result.results as any[];
}
