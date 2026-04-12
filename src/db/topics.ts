import type { TopicRow, WordStatsRow } from "../types";

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

export async function getRelatedTopics(db: D1Database, topicId: number, limit = 6) {
  const result = await db.prepare(
    `SELECT t.name, t.slug, COUNT(*) as co_count
     FROM chunk_topics ct1
     JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
     JOIN topics t ON ct2.topic_id = t.id
     WHERE ct1.topic_id = ?
     GROUP BY ct2.topic_id
     ORDER BY co_count DESC
     LIMIT ?`
  ).bind(topicId, limit).all();
  return result.results as { name: string; slug: string; co_count: number }[];
}

export async function getTopicWordStats(db: D1Database, topicName: string) {
  return await db.prepare(
    "SELECT total_count, doc_count, distinctiveness, in_baseline FROM word_stats WHERE word = ?"
  ).bind(topicName.toLowerCase()).first<Pick<WordStatsRow, "total_count" | "doc_count" | "distinctiveness" | "in_baseline">>();
}

export async function getTopTopicsWithSparklines(db: D1Database, limit = 20) {
  const topTopics = await db.prepare(
    "SELECT id, name, slug, usage_count FROM topics WHERE usage_count >= 3 ORDER BY usage_count DESC LIMIT ?"
  ).bind(limit).all<TopicRow>();

  if (!topTopics.results.length) return [];

  const topicIds = topTopics.results.map(t => t.id);
  const placeholders = topicIds.map(() => "?").join(",");
  const timeline = await db.prepare(
    `SELECT ct.topic_id, e.published_date, COUNT(*) as count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id IN (${placeholders})
     GROUP BY ct.topic_id, e.id
     ORDER BY e.published_date ASC`
  ).bind(...topicIds).all();

  const allDates = [...new Set((timeline.results as any[]).map(r => r.published_date))].sort();

  return topTopics.results.map(topic => {
    const points = allDates.map(date => {
      const match = (timeline.results as any[]).find(r => r.topic_id === topic.id && r.published_date === date);
      return match ? match.count : 0;
    });
    return { ...topic, sparkline: points, dates: allDates };
  });
}
