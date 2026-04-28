import type { TopicRow, WordStatsRow } from "../types";
import { chunkForSqlBindings, sqlPlaceholders } from "../lib/db";
import { topicSupportThreshold } from "../lib/topic-metrics";

export interface TopicAdjacent {
  name: string;
  slug: string;
  usage_count: number;
  distinctiveness: number;
}

export interface TopicRankHistoryPoint {
  year: number;
  count: number;
  rank: number;
}

export interface TrendingTopic {
  name: string;
  slug: string;
  spikeRatio: number;
}

export { chunkForSqlBindings } from "../lib/db";

async function topicsHasColumn(db: D1Database, columnName: string): Promise<boolean> {
  const result = await db.prepare("PRAGMA table_info(topics)").all<{ name: string }>();
  return result.results.some((row) => row.name === columnName);
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).bind(tableName).first<{ name: string }>();
  return Boolean(result?.name);
}

function topicSupportClause(alias: string, hasEpisodeSupport: boolean): string {
  return hasEpisodeSupport
    ? `(${alias}episode_support >= ? OR (${alias}episode_support = 0 AND ${alias}usage_count >= ?))`
    : `${alias}usage_count >= ?`;
}

function topicSupportBindings(minEpisodeSupport: number, hasEpisodeSupport: boolean): number[] {
  const minimumFallbackUsage = Math.max(minEpisodeSupport, 3);
  return hasEpisodeSupport
    ? [minEpisodeSupport, minEpisodeSupport]
    : [minimumFallbackUsage];
}

async function loadTopicSupportThreshold(db: D1Database): Promise<number> {
  const hasEpisodeSupport = await topicsHasColumn(db, "episode_support");
  if (!hasEpisodeSupport) {
    const totalEpisodes = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
    return topicSupportThreshold(totalEpisodes?.c ?? 0);
  }

  const populated = await db.prepare(
    "SELECT COUNT(*) as c FROM topics WHERE usage_count > 0 AND episode_support > 0"
  ).first<{ c: number }>();
  if ((populated?.c ?? 0) === 0) return 0;

  const totalEpisodes = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
  return topicSupportThreshold(totalEpisodes?.c ?? 0);
}

export async function getTrendingTopicsForEpisode(db: D1Database, episodeId: number, limit = 3): Promise<TrendingTopic[]> {
  const minEpisodeSupport = await loadTopicSupportThreshold(db);
  const hasEpisodeSupport = await topicsHasColumn(db, "episode_support");
  // Get topic counts for this episode (only topics with sufficient corpus usage)
  const epTopics = await db.prepare(
    `SELECT t.id, t.name, t.slug, COUNT(*) as ep_count, t.usage_count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN topics t ON ct.topic_id = t.id
     WHERE c.episode_id = ?
        AND ${topicSupportClause("t.", hasEpisodeSupport)}
        AND t.hidden = 0 AND t.display_suppressed = 0
       GROUP BY t.id`
  ).bind(episodeId, ...topicSupportBindings(minEpisodeSupport, hasEpisodeSupport)).all();

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
  const result = await db.prepare(
    `SELECT * FROM topics WHERE usage_count >= 3 AND hidden = 0 AND display_suppressed = 0
     ORDER BY usage_count * CASE
        WHEN distinctiveness > 0 THEN distinctiveness
        WHEN name LIKE '% %' THEN 20
        ELSE 1
      END DESC LIMIT ?`
  ).bind(limit * 3).all<TopicRow>();
  return result.results.slice(0, limit);
}

export async function getTopicBySlug(db: D1Database, slug: string): Promise<TopicRow | null> {
  return await db.prepare("SELECT * FROM topics WHERE slug = ? AND hidden = 0 AND display_suppressed = 0")
    .bind(slug).first<TopicRow>();
}

export async function getTopicChunkCount(db: D1Database, topicId: number): Promise<number> {
  const result = await db.prepare(
    "SELECT COUNT(*) as count FROM chunk_topics WHERE topic_id = ?"
  ).bind(topicId).first<{ count: number }>();
  return result?.count || 0;
}

export async function getTopicChunks(
  db: D1Database,
  topicId: number,
  limit: number,
  offset: number,
  sort: "newest" | "oldest" = "newest",
) {
  const orderClause = sort === "oldest"
    ? "ORDER BY e.published_date ASC, c.position ASC, c.id ASC"
    : "ORDER BY e.published_date DESC, c.position ASC, c.id ASC";
  const result = await db.prepare(
    `SELECT c.id, c.episode_id, c.slug, c.title, c.content_plain, c.position,
            e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id = ?
     ${orderClause}
     LIMIT ? OFFSET ?`
  ).bind(topicId, limit, offset).all();
  return result.results;
}

export async function getTopicAllChunks(db: D1Database, topicId: number) {
  const result = await db.prepare(
    `SELECT c.id, c.episode_id, c.slug, c.title, c.content_plain, c.position,
            e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.topic_id = ?
     ORDER BY e.published_date ASC, c.position ASC, c.id ASC`
  ).bind(topicId).all();
  return result.results as any[];
}

export async function getTopicDriftChunks(db: D1Database, topicId: number, sampleSize = 30) {
  const result = await db.prepare(
    `WITH ordered AS (
       SELECT c.id, c.content_plain, e.published_date, c.position
       FROM chunks c
       JOIN chunk_topics ct ON c.id = ct.chunk_id
       JOIN episodes e ON c.episode_id = e.id
       WHERE ct.topic_id = ?
       ORDER BY e.published_date ASC, c.position ASC, c.id ASC
     ), early AS (
       SELECT * FROM ordered LIMIT ?
     ), late AS (
       SELECT * FROM ordered
       ORDER BY published_date DESC, position DESC, id DESC
       LIMIT ?
     )
     SELECT * FROM early
     UNION ALL
     SELECT * FROM late WHERE id NOT IN (SELECT id FROM early)
     ORDER BY published_date ASC, position ASC, id ASC`
  ).bind(topicId, sampleSize, sampleSize).all();

  return result.results as Array<{ id: number; content_plain: string; published_date: string; position: number }>;
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
     ORDER BY e.published_date ASC, c.position ASC, c.id ASC`
  ).bind(topicId).all();
  return result.results as any[];
}

export async function getTopicEpisodes(db: D1Database, topicId: number) {
  const result = await db.prepare(
    `SELECT e.*, COUNT(ct.chunk_id) as topic_chunk_count
      FROM episodes e
      JOIN chunks c ON c.episode_id = e.id
      JOIN chunk_topics ct ON c.id = ct.chunk_id
      WHERE ct.topic_id = ?
      GROUP BY e.id
      ORDER BY e.published_date ASC`
  ).bind(topicId).all();
  return result.results as any[];
}

export async function getRelatedTopics(db: D1Database, topicId: number, limit = 6) {
  const minEpisodeSupport = await loadTopicSupportThreshold(db);
  const hasEpisodeSupport = await topicsHasColumn(db, "episode_support");
  const hasSimilarityTable = await tableExists(db, "topic_similarity_scores");
  if (hasSimilarityTable) {
    const cached = await db.prepare(
      `SELECT t.name, t.slug, s.overlap_count as co_count
       FROM topic_similarity_scores s
       JOIN topics t ON t.id = s.related_topic_id
       WHERE s.topic_id = ?
         AND t.hidden = 0
         AND t.display_suppressed = 0
         AND ${topicSupportClause("t.", hasEpisodeSupport)}
       ORDER BY s.combined_score DESC, s.overlap_count DESC, t.name ASC
       LIMIT ?`
    ).bind(topicId, ...topicSupportBindings(minEpisodeSupport, hasEpisodeSupport), limit).all<{ name: string; slug: string; co_count: number }>();
    if (cached.results.length > 0) {
      return cached.results as { name: string; slug: string; co_count: number }[];
    }
  }

  const result = await db.prepare(
    `SELECT t.name, t.slug, COUNT(*) as co_count
      FROM chunk_topics ct1
      JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
      JOIN topics t ON ct2.topic_id = t.id
      WHERE ct1.topic_id = ?
        AND t.hidden = 0
        AND t.display_suppressed = 0
        AND ${topicSupportClause("t.", hasEpisodeSupport)}
      GROUP BY ct2.topic_id
      ORDER BY co_count DESC
      LIMIT ?`
  ).bind(topicId, ...topicSupportBindings(minEpisodeSupport, hasEpisodeSupport), limit).all();
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

export async function getTopicRankHistory(db: D1Database, topicId: number): Promise<TopicRankHistoryPoint[]> {
  const result = await db.prepare(
    `WITH yearly_counts AS (
       SELECT ct.topic_id, e.year, COUNT(*) as year_count
       FROM chunk_topics ct
       JOIN chunks c ON ct.chunk_id = c.id
       JOIN episodes e ON c.episode_id = e.id
       JOIN topics t ON ct.topic_id = t.id
       WHERE t.hidden = 0 AND t.display_suppressed = 0
       GROUP BY ct.topic_id, e.year
     ), ranked AS (
       SELECT topic_id, year, year_count,
              ROW_NUMBER() OVER (PARTITION BY year ORDER BY year_count DESC, topic_id ASC) as rank
       FROM yearly_counts
     )
     SELECT year, year_count as count, rank
     FROM ranked
     WHERE topic_id = ?
     ORDER BY year ASC`
  ).bind(topicId).all();

  return (result.results as any[]).map((row) => ({
    year: Number(row.year),
    count: Number(row.count),
    rank: Number(row.rank),
  }));
}

export async function getAdjacentTopics(db: D1Database, topicId: number) {
  const result = await db.prepare(
    `SELECT id, name, slug, usage_count, distinctiveness
     FROM topics
     WHERE hidden = 0 AND display_suppressed = 0
     ORDER BY usage_count DESC, distinctiveness DESC, name ASC`
  ).all<TopicAdjacent & { id: number }>();

  const topics = result.results;
  const index = topics.findIndex((topic) => topic.id === topicId);

  if (index === -1) {
    return { rank: null, above: null, below: null };
  }

  return {
    rank: index + 1,
    above: index > 0 ? topics[index - 1] : null,
    below: index < topics.length - 1 ? topics[index + 1] : null,
  };
}

export async function getTopTopicsWithSparklines(db: D1Database, limit?: number) {
  const minEpisodeSupport = await loadTopicSupportThreshold(db);
  const hasEpisodeSupport = await topicsHasColumn(db, "episode_support");
  const minimumEpisodeSupportFloor = Math.max(minEpisodeSupport, 1);
  const minimumFallbackUsage = Math.max(minEpisodeSupport, 3);
  // Fetch a wide pool of candidates — we'll rank by temporal interest after computing sparklines.
  const candidateQuery = limit
    ? db.prepare(
        `SELECT id, name, slug, usage_count, distinctiveness FROM topics
         WHERE ${topicSupportClause("", hasEpisodeSupport)} AND hidden = 0 AND display_suppressed = 0
         ORDER BY usage_count * CASE
               WHEN distinctiveness > 0 THEN distinctiveness
               WHEN name LIKE '% %' THEN 20
               ELSE 1
             END DESC
         LIMIT ?`
      ).bind(...(hasEpisodeSupport ? [minimumEpisodeSupportFloor, minimumFallbackUsage] : [minimumFallbackUsage]), limit * 4)
    : db.prepare(
        `SELECT id, name, slug, usage_count, distinctiveness FROM topics
         WHERE ${topicSupportClause("", hasEpisodeSupport)} AND hidden = 0 AND display_suppressed = 0
         ORDER BY usage_count * CASE
               WHEN distinctiveness > 0 THEN distinctiveness
               WHEN name LIKE '% %' THEN 20
               ELSE 1
             END DESC`
      ).bind(...(hasEpisodeSupport ? [minimumEpisodeSupportFloor, minimumFallbackUsage] : [minimumFallbackUsage]));

  const candidates = await candidateQuery.all<TopicRow>();

  if (!candidates.results.length) return [];

  const pool = candidates.results;

  if (!pool.length) return [];

  // Build sparklines for the entire pool
  const poolIds = pool.map(t => t.id);
  const timelineRows: Array<{ topic_id: number; published_date: string; count: number }> = [];

  for (const topicIdBatch of chunkForSqlBindings(poolIds)) {
    const placeholders = sqlPlaceholders(topicIdBatch.length);
    const timeline = await db.prepare(
      `SELECT ct.topic_id, e.published_date, COUNT(*) as count
       FROM chunk_topics ct
       JOIN chunks c ON ct.chunk_id = c.id
       JOIN episodes e ON c.episode_id = e.id
       WHERE ct.topic_id IN (${placeholders})
       GROUP BY ct.topic_id, e.id
       ORDER BY e.published_date ASC`
    ).bind(...topicIdBatch).all<{ topic_id: number; published_date: string; count: number }>();

    timelineRows.push(...timeline.results);
  }

  const allDates = [...new Set(timelineRows.map((row) => row.published_date))].sort();
  const timelineByTopicAndDate = new Map(timelineRows.map((row) => [`${row.topic_id}:${row.published_date}`, row.count]));

  const withSparklines = pool.map(topic => {
    const points = allDates.map((date) => timelineByTopicAndDate.get(`${topic.id}:${date}`) ?? 0);
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
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}
