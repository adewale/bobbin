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

export interface BlendedEpisodeTopics {
  /** Top topics by raw chunk count in this episode (what it covers) */
  main: TopicRow[];
  /** Topics over-represented in this episode vs corpus (what makes it distinctive) */
  distinctive: TopicRow[];
}

export async function getEpisodeTopicsBlended(
  db: D1Database,
  episodeId: number,
  mainLimit = 5,
  distinctiveLimit = 5
): Promise<BlendedEpisodeTopics> {
  // Get topic chunk counts for this episode
  const epTopics = await db.prepare(
    `SELECT t.*, COUNT(*) as ep_count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN topics t ON ct.topic_id = t.id
     WHERE c.episode_id = ?
     GROUP BY t.id
     ORDER BY ep_count DESC`
  ).bind(episodeId).all();

  // Get total episode count for IDF
  const totalEps = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
  const N = totalEps?.c || 1;

  const topics = (epTopics.results as any[]).filter(t => !isNoiseTopic(t.name));

  // Main: top topics by raw chunk count (what this episode covers)
  const main = topics.slice(0, mainLimit) as TopicRow[];

  // Distinctive: TF-IDF scored, minimum 2 chunks in episode
  // Count how many episodes each topic appears in
  const topicIds = topics.filter(t => t.ep_count >= 2).map(t => t.id);
  let distinctiveTopics: TopicRow[] = [];

  if (topicIds.length > 0) {
    const placeholders = topicIds.map(() => "?").join(",");
    const epCounts = await db.prepare(
      `SELECT topic_id, COUNT(DISTINCT episode_id) as ep_appearances
       FROM episode_topics
       WHERE topic_id IN (${placeholders})
       GROUP BY topic_id`
    ).bind(...topicIds).all();

    const epAppearanceMap = new Map<number, number>();
    for (const r of epCounts.results as any[]) {
      epAppearanceMap.set(r.topic_id, r.ep_appearances);
    }

    const scored = topics
      .filter(t => t.ep_count >= 2 && epAppearanceMap.has(t.id))
      .map(t => {
        const df = epAppearanceMap.get(t.id) || 1;
        const idf = Math.log(N / df);
        const tfidf = t.ep_count * idf;
        return { ...t, tfidf };
      })
      .sort((a, b) => b.tfidf - a.tfidf);

    // Exclude topics already in main (avoid duplication)
    const mainSlugs = new Set(main.map(t => t.slug));
    distinctiveTopics = scored
      .filter(t => !mainSlugs.has(t.slug))
      .slice(0, distinctiveLimit) as TopicRow[];
  }

  return { main, distinctive: distinctiveTopics };
}

/** Legacy: flat list for contexts that don't need the blend (e.g., homepage latest panel) */
export async function getEpisodeTopics(db: D1Database, episodeId: number): Promise<TopicRow[]> {
  const blended = await getEpisodeTopicsBlended(db, episodeId, 10, 0);
  return blended.main;
}

export async function getAllEpisodesGrouped(db: D1Database): Promise<EpisodeRow[]> {
  const result = await db.prepare(
    "SELECT * FROM episodes ORDER BY published_date DESC"
  ).all<EpisodeRow>();
  return result.results;
}

export async function getAdjacentEpisodes(db: D1Database, publishedDate: string): Promise<{ prev: EpisodeRow | null; next: EpisodeRow | null }> {
  const [prev, next] = await Promise.all([
    db.prepare(
      "SELECT * FROM episodes WHERE published_date < ? ORDER BY published_date DESC LIMIT 1"
    ).bind(publishedDate).first<EpisodeRow>(),
    db.prepare(
      "SELECT * FROM episodes WHERE published_date > ? ORDER BY published_date ASC LIMIT 1"
    ).bind(publishedDate).first<EpisodeRow>(),
  ]);
  return { prev: prev || null, next: next || null };
}
