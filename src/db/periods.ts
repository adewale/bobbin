// Period-scoped data helpers for summary pages.
//
// These mirror the episode-rail insight queries (`getEpisodeRailInsights`,
// `getTrendingTopicsForEpisode`) but scope by date range instead of a single
// episode id. Returned shapes intentionally match their episode-scoped
// counterparts so the same `<TopicList>` and rail-panel components render
// summaries with no per-route variants.
//
// All helpers accept `PeriodBounds` rather than a `Period` so the same code
// path works for any period kind (year, month, and any future kind that
// produces date bounds).

import type { ChunkRow, EpisodeRow } from "../types";
import type { PeriodBounds } from "../lib/period";
import { topicSupportThreshold } from "../lib/topic-metrics";
import { weightedDeltaScore, weightedTopicScore } from "../lib/topic-scoring";
import type { TrendingTopic } from "./topics";

export interface PeriodTopicCount {
  id: number;
  name: string;
  slug: string;
  distinctiveness: number;
  chunk_count: number;
}

export interface PeriodMover {
  name: string;
  slug: string;
  delta: number;
}

export interface PeriodMovers {
  intensified: PeriodMover[];
  downshifted: PeriodMover[];
}

export interface PeriodNewTopic {
  name: string;
  slug: string;
}

export interface PeriodConnectedChunk {
  id: number;
  slug: string;
  title: string;
  episode_slug: string;
  published_date: string;
  reach: number;
}

async function topicsHasColumn(db: D1Database, columnName: string): Promise<boolean> {
  const result = await db.prepare("PRAGMA table_info(topics)").all<{ name: string }>();
  return result.results.some((row) => row.name === columnName);
}

export async function getEpisodesInPeriod(
  db: D1Database,
  bounds: PeriodBounds,
): Promise<EpisodeRow[]> {
  const result = await db.prepare(
    `SELECT * FROM episodes
     WHERE published_date BETWEEN ? AND ?
     ORDER BY published_date ASC`
  ).bind(bounds.start, bounds.end).all<EpisodeRow>();
  return result.results;
}

export async function getChunksInPeriod(
  db: D1Database,
  bounds: PeriodBounds,
): Promise<ChunkRow[]> {
  const result = await db.prepare(
    `SELECT c.* FROM chunks c
     JOIN episodes e ON e.id = c.episode_id
     WHERE e.published_date BETWEEN ? AND ?
     ORDER BY e.published_date ASC, c.position ASC`
  ).bind(bounds.start, bounds.end).all<ChunkRow>();
  return result.results;
}

export async function getPeriodTopicCounts(
  db: D1Database,
  bounds: PeriodBounds,
): Promise<PeriodTopicCount[]> {
  const result = await db.prepare(
    `SELECT t.id, t.name, t.slug, t.distinctiveness, COUNT(*) as chunk_count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON e.id = c.episode_id
     JOIN topics t ON ct.topic_id = t.id
     WHERE e.published_date BETWEEN ? AND ?
       AND t.hidden = 0 AND t.display_suppressed = 0
     GROUP BY t.id
     ORDER BY chunk_count DESC, t.name ASC`
  ).bind(bounds.start, bounds.end).all();

  return (result.results as any[]).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    distinctiveness: Number(row.distinctiveness ?? 0),
    chunk_count: Number(row.chunk_count),
  }));
}

// Topics that first appear (in any episode) within this period — i.e. the
// earliest episode mentioning the topic falls inside the period bounds.
// Same "new to corpus" semantic the episode rail uses.
export async function getPeriodNewTopics(
  db: D1Database,
  bounds: PeriodBounds,
  limit?: number,
): Promise<PeriodNewTopic[]> {
  const result = await db.prepare(
    `SELECT t.id, t.name, t.slug, t.distinctiveness,
            SUM(CASE WHEN e.published_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS period_chunk_count,
            MIN(e.published_date) AS first_seen
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON e.id = c.episode_id
     JOIN topics t ON ct.topic_id = t.id
      WHERE t.hidden = 0 AND t.display_suppressed = 0
      GROUP BY t.id
      HAVING first_seen BETWEEN ? AND ?
      ORDER BY period_chunk_count DESC, t.name ASC`
  ).bind(bounds.start, bounds.end, bounds.start, bounds.end).all();

  const scored = (result.results as any[])
    .map((row) => ({
      name: String(row.name),
      slug: String(row.slug),
      score: weightedTopicScore(Number(row.period_chunk_count), Number(row.distinctiveness ?? 0)),
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map(({ name, slug }) => ({ name, slug }));

  return typeof limit === "number" ? scored.slice(0, limit) : scored;
}

// Movers: salience-weighted intensified / downshifted topics relative to a
// previous comparable period. Mirrors the per-episode `sinceLast` logic.
export async function getPeriodMovers(
  db: D1Database,
  current: PeriodBounds,
  previous: PeriodBounds,
  limit?: number,
): Promise<PeriodMovers> {
  const [currentTopics, previousTopics] = await Promise.all([
    getPeriodTopicCounts(db, current),
    getPeriodTopicCounts(db, previous),
  ]);

  const previousById = new Map(previousTopics.map((topic) => [topic.id, topic]));
  const currentById = new Map(currentTopics.map((topic) => [topic.id, topic]));

  const scored = currentTopics.map((topic) => {
    const previous = previousById.get(topic.id);
    const previousCount = previous?.chunk_count ?? 0;
    const delta = topic.chunk_count - previousCount;
    return {
      name: topic.name,
      slug: topic.slug,
      delta,
      score: weightedDeltaScore(delta, topic.chunk_count, previousCount, topic.distinctiveness),
    };
  });

  const disappeared = previousTopics
    .filter((topic) => !currentById.has(topic.id))
    .map((topic) => ({
      name: topic.name,
      slug: topic.slug,
      delta: -topic.chunk_count,
      score: weightedDeltaScore(-topic.chunk_count, 0, topic.chunk_count, topic.distinctiveness),
    }));

  const intensified = scored
    .filter((topic) => topic.delta > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map(({ name, slug, delta }) => ({ name, slug, delta }));

  const downshifted = [...scored.filter((topic) => topic.delta < 0), ...disappeared]
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map(({ name, slug, delta }) => ({ name, slug, delta }));

  if (typeof limit !== "number") {
    return { intensified, downshifted };
  }

  return {
    intensified: intensified.slice(0, limit),
    downshifted: downshifted.slice(0, limit),
  };
}

// Archive contrast: topics over-indexed within the period vs the rest of
// the corpus. Mirrors `getTrendingTopicsForEpisode`'s spike-ratio shape so
// the same `<TopicList layout="stack">` + count modifier renders both.
export async function getPeriodArchiveContrast(
  db: D1Database,
  bounds: PeriodBounds,
  limit = 5,
): Promise<TrendingTopic[]> {
  const totalEpisodeCount = await db.prepare(
    `SELECT COUNT(*) as c FROM episodes`
  ).first<{ c: number }>();
  const minEpisodeSupport = topicSupportThreshold(totalEpisodeCount?.c ?? 0);
  const hasEpisodeSupport = await topicsHasColumn(db, "episode_support");
  const periodTopicsResult = await db.prepare(
    `SELECT t.id, t.name, t.slug, t.usage_count,
            COUNT(*) AS period_count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON e.id = c.episode_id
     JOIN topics t ON ct.topic_id = t.id
       WHERE e.published_date BETWEEN ? AND ?
         AND ${hasEpisodeSupport
           ? "(t.episode_support >= ? OR (t.episode_support = 0 AND t.usage_count >= ?))"
           : "t.usage_count >= ?"}
         AND t.hidden = 0 AND t.display_suppressed = 0
       GROUP BY t.id`
  ).bind(
    bounds.start,
    bounds.end,
    minEpisodeSupport,
    ...(hasEpisodeSupport ? [minEpisodeSupport] : []),
  ).all();

  const periodEpisodeCount = await db.prepare(
    `SELECT COUNT(*) as c FROM episodes WHERE published_date BETWEEN ? AND ?`
  ).bind(bounds.start, bounds.end).first<{ c: number }>();

  const periodEps = Math.max(periodEpisodeCount?.c ?? 0, 1);
  const totalEps = Math.max(totalEpisodeCount?.c ?? 0, 1);

  return (periodTopicsResult.results as any[])
    .map((row) => {
      const periodCount = Number(row.period_count);
      const corpusUsage = Number(row.usage_count);
      const expectedPerEpisode = corpusUsage / totalEps;
      const observedPerEpisode = periodCount / periodEps;
      const spikeRatio = expectedPerEpisode > 0 ? observedPerEpisode / expectedPerEpisode : 0;
      return {
        name: String(row.name),
        slug: String(row.slug),
        spikeRatio,
      } as TrendingTopic;
    })
    .filter((topic) => topic.spikeRatio > 1.5)
    .sort((left, right) => right.spikeRatio - left.spikeRatio || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export async function getMostConnectedInPeriod(
  db: D1Database,
  bounds: PeriodBounds,
  limit = 5,
): Promise<PeriodConnectedChunk[]> {
  const hasReach = await db.prepare(
    `SELECT COUNT(*) as c FROM chunks c
     JOIN episodes e ON e.id = c.episode_id
     WHERE e.published_date BETWEEN ? AND ? AND c.reach > 0`
  ).bind(bounds.start, bounds.end).first<{ c: number }>();

  if (hasReach && hasReach.c > 0) {
    const result = await db.prepare(
      `SELECT c.id, c.slug, c.title, c.reach,
              e.slug as episode_slug, e.published_date
        FROM chunks c
        JOIN episodes e ON e.id = c.episode_id
        WHERE e.published_date BETWEEN ? AND ? AND c.reach > 0
        ORDER BY c.reach DESC, e.published_date DESC, c.slug ASC
        LIMIT ?`
    ).bind(bounds.start, bounds.end, limit).all();
    return (result.results as any[]).map((row) => ({
      id: Number(row.id),
      slug: String(row.slug),
      title: String(row.title),
      episode_slug: String(row.episode_slug),
      published_date: String(row.published_date),
      reach: Number(row.reach),
    }));
  }

  // Fallback: compute reach on the fly within the period.
  const result = await db.prepare(
    `SELECT c.id, c.slug, c.title,
            e.slug as episode_slug, e.published_date,
            SUM(t.usage_count) as reach
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN topics t ON ct.topic_id = t.id
     JOIN episodes e ON c.episode_id = e.id
      WHERE e.published_date BETWEEN ? AND ?
        AND t.hidden = 0 AND t.display_suppressed = 0
      GROUP BY c.id
      ORDER BY reach DESC, e.published_date DESC, c.slug ASC
      LIMIT ?`
   ).bind(bounds.start, bounds.end, limit).all();

  return (result.results as any[]).map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    episode_slug: String(row.episode_slug),
    published_date: String(row.published_date),
    reach: Number(row.reach ?? 0),
  }));
}
