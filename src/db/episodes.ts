import type { EpisodeRow, ChunkRow, TopicRow } from "../types";
import { isNoiseTopic } from "../services/topic-quality";

export async function getRecentEpisodes(db: D1Database, limit: number): Promise<EpisodeRow[]> {
  const result = await db.prepare(
    "SELECT * FROM episodes ORDER BY published_date DESC LIMIT ?"
  ).bind(limit).all<EpisodeRow>();
  return result.results;
}

export async function getEpisodeBySlug(db: D1Database, slug: string): Promise<EpisodeRow | null> {
  return await db.prepare(
    "SELECT * FROM episodes WHERE slug = ?"
  ).bind(slug).first<EpisodeRow>();
}

export async function getChunksByEpisode(db: D1Database, episodeId: number): Promise<ChunkRow[]> {
  const result = await db.prepare(
    "SELECT * FROM chunks WHERE episode_id = ? ORDER BY position"
  ).bind(episodeId).all<ChunkRow>();
  return result.results;
}

export async function getEpisodeTopics(db: D1Database, episodeId: number): Promise<TopicRow[]> {
  const result = await db.prepare(
    `SELECT t.* FROM topics t
     JOIN episode_topics et ON t.id = et.topic_id
     WHERE et.episode_id = ?
     ORDER BY t.usage_count * CASE
       WHEN t.distinctiveness > 0 THEN t.distinctiveness
       WHEN t.name LIKE '% %' THEN 20
       ELSE 1
     END DESC`
  ).bind(episodeId).all<TopicRow>();
  return result.results.filter(t => !isNoiseTopic(t.name));
}

export async function getAllEpisodesGrouped(db: D1Database): Promise<EpisodeRow[]> {
  const result = await db.prepare(
    "SELECT * FROM episodes ORDER BY published_date DESC"
  ).all<EpisodeRow>();
  return result.results;
}
