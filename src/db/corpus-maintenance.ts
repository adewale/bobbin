import { batchExec } from "../lib/db";
import { computeSpanAwareBurstScore, quarterKeyFromIsoDate } from "../lib/topic-metrics";
import { topicsHasColumn } from "./topic-support";
import { rebuildWordStatsAggregates } from "../services/word-stats";

export interface CorpusRepairResult {
  topicsRecounted: number;
  episodeSupportRecounted: number | null;
  episodeTopicsRebuilt: number;
  wordStatsRebuilt: boolean;
  topicDistinctivenessRebuilt: number;
  topicBurstMetricsRebuilt: number;
  chunkReachRecomputed: number;
}

export interface CorpusInvariantAudit {
  healthy: boolean;
  orphanChunkTopics: number;
  orphanEpisodeTopics: number;
  orphanChunkWords: number;
  usageMismatches: number;
  supportMismatches: number | null;
  driftedEpisodeChunkCounts: number;
  wordStatsTotalDelta: number;
}

async function recountUsage(db: D1Database): Promise<number> {
  const rows = await db.prepare("SELECT COUNT(*) as c FROM topics").first<{ c: number }>();
  await db.prepare(
    `UPDATE topics
     SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = topics.id)`
  ).run();
  return rows?.c || 0;
}

async function recountEpisodeSupport(db: D1Database): Promise<number | null> {
  if (!(await topicsHasColumn(db, "episode_support"))) return null;
  const rows = await db.prepare("SELECT COUNT(*) as c FROM topics").first<{ c: number }>();
  await db.prepare(
    `UPDATE topics
     SET episode_support = (
       SELECT COUNT(DISTINCT c.episode_id)
       FROM chunk_topics ct
       JOIN chunks c ON c.id = ct.chunk_id
       WHERE ct.topic_id = topics.id
     )`
  ).run();
  return rows?.c || 0;
}

async function rebuildEpisodeTopics(db: D1Database): Promise<number> {
  await db.prepare("DELETE FROM episode_topics").run();
  const insert = await db.prepare(
    `INSERT OR IGNORE INTO episode_topics (episode_id, topic_id)
     SELECT DISTINCT c.episode_id, ct.topic_id
     FROM chunk_topics ct
     JOIN chunks c ON c.id = ct.chunk_id`
  ).run();
  return insert.meta.changes || 0;
}

async function syncTopicDistinctiveness(db: D1Database): Promise<number> {
  const rows = await db.prepare("SELECT COUNT(*) as c FROM topics").first<{ c: number }>();
  await db.prepare(
    `UPDATE topics
     SET distinctiveness = COALESCE((SELECT w.distinctiveness FROM word_stats w WHERE w.word = LOWER(topics.name)), 0)`
  ).run();
  return rows?.c || 0;
}

async function syncTopicBurstMetrics(db: D1Database): Promise<number> {
  if (!(await topicsHasColumn(db, "burst_score"))) return 0;
  const rows = await db.prepare(
    `SELECT ct.topic_id, e.published_date, COUNT(*) as mention_count
     FROM chunk_topics ct
     JOIN chunks c ON c.id = ct.chunk_id
     JOIN episodes e ON e.id = c.episode_id
     GROUP BY ct.topic_id, e.published_date
     ORDER BY ct.topic_id ASC, e.published_date ASC`
  ).all<{ topic_id: number; published_date: string; mention_count: number }>();

  const countsByTopic = new Map<number, Map<string, number>>();
  const firstQuarterByTopic = new Map<number, string>();
  const lastQuarterByTopic = new Map<number, string>();
  for (const row of rows.results) {
    const quarter = quarterKeyFromIsoDate(row.published_date);
    const current = countsByTopic.get(row.topic_id) ?? new Map<string, number>();
    current.set(quarter, (current.get(quarter) ?? 0) + Number(row.mention_count));
    countsByTopic.set(row.topic_id, current);
    if (!firstQuarterByTopic.has(row.topic_id) || quarter < (firstQuarterByTopic.get(row.topic_id) ?? quarter)) {
      firstQuarterByTopic.set(row.topic_id, quarter);
    }
    if (!lastQuarterByTopic.has(row.topic_id) || quarter > (lastQuarterByTopic.get(row.topic_id) ?? quarter)) {
      lastQuarterByTopic.set(row.topic_id, quarter);
    }
  }

  const topics = await db.prepare("SELECT id FROM topics").all<{ id: number }>();
  const updates = topics.results.map((topic) => {
    const burst = computeSpanAwareBurstScore(
      countsByTopic.get(topic.id) ?? new Map(),
      firstQuarterByTopic.get(topic.id) ?? null,
      lastQuarterByTopic.get(topic.id) ?? null,
    );
    return db.prepare(
      "UPDATE topics SET burst_score = ?, burst_peak_quarter = ? WHERE id = ?"
    ).bind(burst.score, burst.peakQuarter, topic.id);
  });
  if (updates.length > 0) await batchExec(db, updates);
  return updates.length;
}

async function recomputeChunkReach(db: D1Database): Promise<number> {
  const rows = await db.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>();
  await db.prepare(
    `UPDATE chunks
     SET reach = (
       SELECT COALESCE(SUM(t.usage_count), 0)
       FROM chunk_topics ct
       JOIN topics t ON ct.topic_id = t.id
       WHERE ct.chunk_id = chunks.id AND t.hidden = 0 AND t.display_suppressed = 0
     )`
  ).run();
  return rows?.c || 0;
}

export async function repairDerivedCorpusState(db: D1Database): Promise<CorpusRepairResult> {
  const episodeTopicsRebuilt = await rebuildEpisodeTopics(db);
  const topicsRecounted = await recountUsage(db);
  const episodeSupportRecounted = await recountEpisodeSupport(db);
  await rebuildWordStatsAggregates(db);
  const topicDistinctivenessRebuilt = await syncTopicDistinctiveness(db);
  const topicBurstMetricsRebuilt = await syncTopicBurstMetrics(db);
  const chunkReachRecomputed = await recomputeChunkReach(db);

  return {
    topicsRecounted,
    episodeSupportRecounted,
    episodeTopicsRebuilt,
    wordStatsRebuilt: true,
    topicDistinctivenessRebuilt,
    topicBurstMetricsRebuilt,
    chunkReachRecomputed,
  };
}

export async function auditCorpusInvariants(db: D1Database): Promise<CorpusInvariantAudit> {
  const hasEpisodeSupport = await topicsHasColumn(db, "episode_support");
  const [orphanChunkTopics, orphanEpisodeTopics, orphanChunkWords, usageMismatches, driftedEpisodeChunkCounts] = await Promise.all([
    db.prepare("SELECT COUNT(*) as c FROM chunk_topics ct LEFT JOIN chunks c ON c.id = ct.chunk_id WHERE c.id IS NULL").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM episode_topics et LEFT JOIN episodes e ON e.id = et.episode_id WHERE e.id IS NULL").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM chunk_words cw LEFT JOIN chunks c ON c.id = cw.chunk_id WHERE c.id IS NULL").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM topics t WHERE t.usage_count != (SELECT COUNT(*) FROM chunk_topics ct WHERE ct.topic_id = t.id)").first<{ c: number }>(),
    db.prepare(
      `SELECT COUNT(*) as c FROM (
         SELECT e.id
         FROM episodes e
         LEFT JOIN chunks c ON c.episode_id = e.id
         GROUP BY e.id
         HAVING e.chunk_count != COUNT(c.id)
       )`
    ).first<{ c: number }>(),
  ]);

  const supportMismatches = hasEpisodeSupport
    ? await db.prepare(
      `SELECT COUNT(*) as c FROM topics t
       WHERE COALESCE(t.episode_support, 0) != (
         SELECT COUNT(DISTINCT et.episode_id)
         FROM episode_topics et
         WHERE et.topic_id = t.id
       )`
    ).first<{ c: number }>()
    : null;

  const totals = await db.prepare(
    `SELECT
       (SELECT COALESCE(SUM(count), 0) FROM chunk_words) AS chunk_word_total,
       (SELECT COALESCE(SUM(total_count), 0) FROM word_stats) AS word_stats_total`
  ).first<{ chunk_word_total: number; word_stats_total: number }>();

  const audit = {
    orphanChunkTopics: orphanChunkTopics?.c || 0,
    orphanEpisodeTopics: orphanEpisodeTopics?.c || 0,
    orphanChunkWords: orphanChunkWords?.c || 0,
    usageMismatches: usageMismatches?.c || 0,
    supportMismatches: supportMismatches ? (supportMismatches.c || 0) : null,
    driftedEpisodeChunkCounts: driftedEpisodeChunkCounts?.c || 0,
    wordStatsTotalDelta: Number(totals?.word_stats_total || 0) - Number(totals?.chunk_word_total || 0),
  };

  return {
    healthy: audit.orphanChunkTopics === 0
      && audit.orphanEpisodeTopics === 0
      && audit.orphanChunkWords === 0
      && audit.usageMismatches === 0
      && (audit.supportMismatches === null || audit.supportMismatches === 0)
      && audit.driftedEpisodeChunkCounts === 0
      && audit.wordStatsTotalDelta === 0,
    ...audit,
  };
}
