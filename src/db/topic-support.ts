import { topicSupportThreshold } from "../lib/topic-metrics";

export interface TopicSupportContext {
  hasEpisodeSupport: boolean;
  minEpisodeSupport: number;
}

export async function topicsHasColumn(db: D1Database, columnName: string): Promise<boolean> {
  const result = await db.prepare("PRAGMA table_info(topics)").all<{ name: string }>();
  return result.results.some((row) => row.name === columnName);
}

export async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).bind(tableName).first<{ name: string }>();
  return Boolean(result?.name);
}

export function topicSupportClause(alias: string, hasEpisodeSupport: boolean): string {
  return hasEpisodeSupport
    ? `(${alias}episode_support >= ? OR (${alias}episode_support = 0 AND ${alias}usage_count >= ?))`
    : `${alias}usage_count >= ?`;
}

export function topicSupportBindings(context: TopicSupportContext): number[] {
  const minimumFallbackUsage = Math.max(context.minEpisodeSupport, 3);
  return context.hasEpisodeSupport
    ? [context.minEpisodeSupport, context.minEpisodeSupport]
    : [minimumFallbackUsage];
}

export async function loadTopicSupportContext(db: D1Database): Promise<TopicSupportContext> {
  const hasEpisodeSupport = await topicsHasColumn(db, "episode_support");
  if (!hasEpisodeSupport) {
    const totalEpisodes = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
    return {
      hasEpisodeSupport,
      minEpisodeSupport: topicSupportThreshold(totalEpisodes?.c ?? 0),
    };
  }

  const populated = await db.prepare(
    "SELECT COUNT(*) as c FROM topics WHERE usage_count > 0 AND episode_support > 0"
  ).first<{ c: number }>();
  if ((populated?.c ?? 0) === 0) {
    return { hasEpisodeSupport, minEpisodeSupport: 0 };
  }

  const totalEpisodes = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
  return {
    hasEpisodeSupport,
    minEpisodeSupport: topicSupportThreshold(totalEpisodes?.c ?? 0),
  };
}
