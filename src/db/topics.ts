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

export async function getTopicKWIC(db: D1Database, topicName: string, limit = 10) {
  const result = await db.prepare(
    `SELECT c.content_plain, c.slug, e.published_date
     FROM chunk_words cw
     JOIN chunks c ON cw.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE cw.word = ?
     ORDER BY cw.count DESC
     LIMIT ?`
  ).bind(topicName.toLowerCase(), limit).all();
  return result.results as { content_plain: string; slug: string; published_date: string }[];
}

export async function getThemeRiverData(db: D1Database, topicLimit = 8) {
  // Get top topics
  const topTopics = await db.prepare(
    `SELECT id, name, slug FROM topics WHERE usage_count >= 5
     ORDER BY usage_count * CASE WHEN distinctiveness > 0 THEN distinctiveness ELSE 1 END DESC LIMIT ?`
  ).bind(topicLimit).all<{ id: number; name: string; slug: string }>();

  if (!topTopics.results.length) return { topics: [], episodes: [], data: [] };

  // Get all episodes ordered by date
  const episodes = await db.prepare(
    "SELECT id, published_date FROM episodes ORDER BY published_date ASC"
  ).all<{ id: number; published_date: string }>();

  // Get counts: topic x episode
  const topicIds = topTopics.results.map(t => t.id);
  const placeholders = topicIds.map(() => "?").join(",");
  const counts = await db.prepare(
    `SELECT ct.topic_id, c.episode_id, COUNT(*) as count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     WHERE ct.topic_id IN (${placeholders})
     GROUP BY ct.topic_id, c.episode_id`
  ).bind(...topicIds).all();

  // Build matrix: topics x episodes
  const countMap = new Map<string, number>();
  for (const r of counts.results as any[]) {
    countMap.set(`${r.topic_id}-${r.episode_id}`, r.count);
  }

  const data = topTopics.results.map(topic => ({
    name: topic.name,
    slug: topic.slug,
    values: episodes.results.map(ep => countMap.get(`${topic.id}-${ep.id}`) || 0),
  }));

  return {
    topics: topTopics.results,
    episodes: episodes.results.map(e => e.published_date),
    data,
  };
}

export async function getTopicRanksByYear(db: D1Database) {
  const result = await db.prepare(
    `SELECT t.id, t.name, t.slug, e.year, COUNT(*) as year_count
     FROM chunk_topics ct
     JOIN topics t ON ct.topic_id = t.id
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     GROUP BY t.id, e.year
     ORDER BY e.year, year_count DESC`
  ).all();

  // Group by year, rank within each year
  const byYear = new Map<number, { id: number; name: string; slug: string; count: number; rank: number }[]>();
  for (const r of result.results as any[]) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year)!.push({ id: r.id, name: r.name, slug: r.slug, count: r.year_count, rank: 0 });
  }
  // Assign ranks (already sorted by count DESC)
  for (const [, topics] of byYear) {
    topics.forEach((t, i) => t.rank = i + 1);
  }
  return byYear;
}

export async function getTopTopicsWithSparklines(db: D1Database, limit = 20) {
  // Rank by usage × distinctiveness to surface interesting topics, not just frequent ones.
  // Multi-word topics (entities/phrases) get a boost since they're higher quality.
  const topTopics = await db.prepare(
    `SELECT id, name, slug, usage_count, distinctiveness FROM topics
     WHERE usage_count >= 3
     ORDER BY usage_count * CASE WHEN distinctiveness > 0 THEN distinctiveness ELSE 1 END
       * CASE WHEN name LIKE '% %' THEN 2 ELSE 1 END DESC
     LIMIT ?`
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
