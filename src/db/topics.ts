import type { TopicRow, WordStatsRow } from "../types";
import { curateTopics, isNoiseTopic } from "../services/topic-quality";

export interface TrendingTopic {
  name: string;
  slug: string;
  spikeRatio: number;
}

export async function getTrendingTopicsForEpisode(db: D1Database, episodeId: number, limit = 3): Promise<TrendingTopic[]> {
  // Get topic counts for this episode (only topics with sufficient corpus usage)
  const epTopics = await db.prepare(
    `SELECT t.id, t.name, t.slug, COUNT(*) as ep_count, t.usage_count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN topics t ON ct.topic_id = t.id
     WHERE c.episode_id = ? AND t.usage_count >= 5
     GROUP BY t.id`
  ).bind(episodeId).all();

  // Get total episode count
  const totalEps = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
  const epCount = totalEps?.c || 1;

  // Compute spike ratio: (count in this ep) / (avg count per ep across corpus)
  const trending = (epTopics.results as any[])
    .map(t => ({
      name: t.name as string,
      slug: t.slug as string,
      spikeRatio: t.ep_count / (t.usage_count / epCount),
    }))
    .filter(t => t.spikeRatio > 2.0)
    .sort((a, b) => b.spikeRatio - a.spikeRatio)
    .slice(0, limit);

  return trending;
}

export async function getTopTopics(db: D1Database, limit: number): Promise<TopicRow[]> {
  const phrases = await db.prepare(
    "SELECT name, usage_count FROM topics WHERE name LIKE '% %' AND usage_count >= 5"
  ).all<{ name: string; usage_count: number }>();

  const result = await db.prepare(
    `SELECT * FROM topics WHERE usage_count >= 3
     ORDER BY usage_count * CASE
       WHEN distinctiveness > 0 THEN distinctiveness
       WHEN name LIKE '% %' THEN 20
       ELSE 1
     END DESC LIMIT ?`
  ).bind(limit * 3).all<TopicRow>();

  const curated = curateTopics(
    result.results.map(t => ({ name: t.name, slug: t.slug, usage_count: t.usage_count, distinctiveness: t.distinctiveness ?? 0 })),
    phrases.results
  );
  const curatedSlugs = new Set(curated.map(t => t.slug));
  return result.results.filter(t => curatedSlugs.has(t.slug)).slice(0, limit);
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
  // Get phrase topics for subsumption check
  const phrases = await db.prepare(
    "SELECT name, usage_count FROM topics WHERE name LIKE '% %' AND usage_count >= 5"
  ).all<{ name: string; usage_count: number }>();

  // Get candidate topics (3x for filtering headroom)
  const candidates = await db.prepare(
    `SELECT id, name, slug, usage_count, distinctiveness FROM topics WHERE usage_count >= 5
     ORDER BY usage_count * CASE
         WHEN distinctiveness > 0 THEN distinctiveness
         WHEN name LIKE '% %' THEN 20
         ELSE 1
       END DESC LIMIT ?`
  ).bind(topicLimit * 3).all<TopicRow>();

  if (!candidates.results.length) return { topics: [], episodes: [], data: [] };

  // Apply quality curation
  const curated = curateTopics(
    candidates.results.map(t => ({
      name: t.name,
      slug: t.slug,
      usage_count: t.usage_count,
      distinctiveness: t.distinctiveness ?? 0,
    })),
    phrases.results
  ).slice(0, topicLimit);

  const curatedSlugs = new Set(curated.map(t => t.slug));
  const topTopics = { results: candidates.results.filter(t => curatedSlugs.has(t.slug)).slice(0, topicLimit) };

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
  // Get phrase topics for subsumption check
  const phrases = await db.prepare(
    "SELECT name, usage_count FROM topics WHERE name LIKE '% %' AND usage_count >= 5"
  ).all<{ name: string; usage_count: number }>();

  // Fetch a wide pool of candidates — we'll rank by temporal interest after computing sparklines
  const candidates = await db.prepare(
    `SELECT id, name, slug, usage_count, distinctiveness FROM topics
     WHERE usage_count >= 5
     ORDER BY usage_count * CASE
         WHEN distinctiveness > 0 THEN distinctiveness
         WHEN name LIKE '% %' THEN 20
         ELSE 1
       END DESC
     LIMIT ?`
  ).bind(limit * 4).all<TopicRow>();

  if (!candidates.results.length) return [];

  // Apply quality curation
  const curated = curateTopics(
    candidates.results.map(t => ({
      name: t.name,
      slug: t.slug,
      usage_count: t.usage_count,
      distinctiveness: t.distinctiveness ?? 0,
    })),
    phrases.results
  );

  const curatedSlugs = new Set(curated.map(t => t.slug));
  const pool = candidates.results.filter(t => curatedSlugs.has(t.slug));

  if (!pool.length) return [];

  // Build sparklines for the entire pool
  const poolIds = pool.map(t => t.id);
  const placeholders = poolIds.map(() => "?").join(",");
  const timeline = await db.prepare(
    `SELECT ct.topic_id, e.published_date, COUNT(*) as count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id IN (${placeholders})
     GROUP BY ct.topic_id, e.id
     ORDER BY e.published_date ASC`
  ).bind(...poolIds).all();

  const allDates = [...new Set((timeline.results as any[]).map(r => r.published_date))].sort();

  const withSparklines = pool.map(topic => {
    const points = allDates.map(date => {
      const match = (timeline.results as any[]).find(r => r.topic_id === topic.id && r.published_date === date);
      return match ? match.count : 0;
    });
    return { ...topic, sparkline: points, dates: allDates };
  });

  // Rank by temporal interest: coefficient of variation (std/mean)
  // Topics with spiky, interesting patterns rank higher than flat lines
  const ranked = withSparklines.map(t => {
    const nonZero = t.sparkline.filter(v => v > 0);
    if (nonZero.length < 2) return { ...t, interest: 0 };
    const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
    const variance = nonZero.reduce((sum, v) => sum + (v - mean) ** 2, 0) / nonZero.length;
    const cv = Math.sqrt(variance) / (mean || 1);
    // Combine temporal interest with distinctiveness for a final score
    // CV alone would over-rank rare topics that spiked once. Multiply by log(usage) for balance.
    const interest = cv * Math.log2(t.usage_count + 1) * (t.name.includes(" ") ? 1.5 : 1);
    return { ...t, interest };
  });

  ranked.sort((a, b) => b.interest - a.interest);
  return ranked.slice(0, limit);
}
