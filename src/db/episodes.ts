import type { EpisodeRow, ChunkRow, TopicRow } from "../types";
import { getTrendingTopicsForEpisode, type TrendingTopic } from "./topics";

export interface EpisodeUnexpectedPairing {
  leftName: string;
  leftSlug: string;
  rightName: string;
  rightSlug: string;
  chunkCount: number;
  corpusCount: number;
}

export interface EpisodeNovelChunk {
  slug: string;
  title: string;
  score: number;
  topics: { name: string; slug: string }[];
}

export interface EpisodeSinceLast {
  previousEpisode: Pick<EpisodeRow, "slug" | "title" | "published_date"> | null;
  intensified: { name: string; slug: string; delta: number }[];
  downshifted: { name: string; slug: string; delta: number }[];
  newTopics: { name: string; slug: string }[];
}

export interface EpisodeRailInsights {
  unexpectedPairings: EpisodeUnexpectedPairing[];
  mostNovelChunks: EpisodeNovelChunk[];
  sinceLast: EpisodeSinceLast;
  archiveContrast: TrendingTopic[];
}

export interface EpisodeNovelTopicHistoryPoint {
  id: number;
  slug: string;
  title: string;
  published_date: string;
  novel_topics: number;
}

export async function getRecentEpisodes(db: D1Database, limit: number): Promise<EpisodeRow[]> {
  const result = await db.prepare(
    "SELECT * FROM episodes ORDER BY published_date DESC LIMIT ?"
  ).bind(limit).all<EpisodeRow>();
  return result.results;
}

export async function getNovelTopicHistory(db: D1Database): Promise<EpisodeNovelTopicHistoryPoint[]> {
  const result = await db.prepare(
    `WITH latest AS (
       SELECT MAX(published_date) AS latest_published_date FROM episodes
     )
     SELECT e.id, e.slug, e.title, e.published_date,
            COUNT(DISTINCT CASE
               WHEN NOT EXISTS (
                 SELECT 1
                FROM episode_topics et2
                JOIN episodes prev ON et2.episode_id = prev.id
                WHERE et2.topic_id = et.topic_id
                  AND (
                    prev.published_date < e.published_date
                    OR (prev.published_date = e.published_date AND prev.id < e.id)
                  )
              ) THEN et.topic_id
            END) as novel_topics
     FROM episodes e, latest
     LEFT JOIN episode_topics et ON e.id = et.episode_id
     WHERE latest.latest_published_date IS NOT NULL
       AND e.published_date >= date(latest.latest_published_date, '-1 year')
     GROUP BY e.id
     ORDER BY e.published_date ASC, e.id ASC`
  ).all<EpisodeNovelTopicHistoryPoint>();

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
     WHERE c.episode_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
     GROUP BY t.id
     ORDER BY ep_count DESC
     LIMIT 100`
  ).bind(episodeId).all();

  // Get total episode count for IDF
  const totalEps = await db.prepare("SELECT COUNT(*) as c FROM episodes").first<{ c: number }>();
  const N = totalEps?.c || 1;

  const topics = epTopics.results as any[];

  // Main: top topics by raw chunk count (what this episode covers)
  const main = topics.slice(0, mainLimit) as TopicRow[];

  // Distinctive: TF-IDF scored, minimum 2 chunks in episode
  // Count how many episodes each topic appears in
  const topicIds = topics.filter(t => t.ep_count >= 2).map(t => t.id);
  let distinctiveTopics: TopicRow[] = [];

  if (topicIds.length > 0) {
    const epCounts = await db.prepare(
      `SELECT et.topic_id, COUNT(DISTINCT et.episode_id) as ep_appearances
       FROM episode_topics et
       JOIN (
         SELECT ct.topic_id
         FROM chunk_topics ct
         JOIN chunks c ON ct.chunk_id = c.id
         JOIN topics t ON ct.topic_id = t.id
         WHERE c.episode_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
         GROUP BY ct.topic_id
         HAVING COUNT(*) >= 2
       ) qualifying_topics ON qualifying_topics.topic_id = et.topic_id
       GROUP BY et.topic_id`
    ).bind(episodeId).all();

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

export async function getEpisodeRailInsights(
  db: D1Database,
  episodeId: number,
  publishedDate: string,
): Promise<EpisodeRailInsights> {
  const currentTopicCountsResult = await db.prepare(
    `SELECT t.id, t.name, t.slug, t.distinctiveness, COUNT(*) as chunk_count
     FROM chunk_topics ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN topics t ON ct.topic_id = t.id
     WHERE c.episode_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
     GROUP BY t.id
     ORDER BY chunk_count DESC, t.name ASC`
  ).bind(episodeId).all();

  const currentChunkTopicRowsResult = await db.prepare(
    `SELECT c.id as chunk_id, c.slug as chunk_slug, c.title as chunk_title, c.position,
            t.id as topic_id, t.name as topic_name, t.slug as topic_slug
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN topics t ON ct.topic_id = t.id
     WHERE c.episode_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
     ORDER BY c.position ASC, t.name ASC`
  ).bind(episodeId).all();

  const [previousEpisode, totalEpisodes, archiveContrast] = await Promise.all([
    db.prepare(
      "SELECT id, slug, title, published_date FROM episodes WHERE published_date < ? ORDER BY published_date DESC LIMIT 1"
    ).bind(publishedDate).first<Pick<EpisodeRow, "id" | "slug" | "title" | "published_date">>(),
    db.prepare("SELECT COUNT(*) as count FROM episodes").first<{ count: number }>(),
    getTrendingTopicsForEpisode(db, episodeId, 5),
  ]);

  const currentTopics = currentTopicCountsResult.results as any[];
  const topicIds = currentTopics.map((topic) => Number(topic.id));
  const totalEpisodeCount = totalEpisodes?.count || 1;

  if (topicIds.length === 0) {
    return {
      unexpectedPairings: [],
      mostNovelChunks: [],
      sinceLast: { previousEpisode: previousEpisode || null, intensified: [], downshifted: [], newTopics: [] },
      archiveContrast,
    };
  }

  const [priorTopicCountsResult, pairCorpusRowsResult, previousTopicCountsResult] = await Promise.all([
    db.prepare(
      `WITH current_topics AS (
         SELECT ct.topic_id
         FROM chunk_topics ct
         JOIN chunks c ON ct.chunk_id = c.id
         JOIN topics t ON ct.topic_id = t.id
         WHERE c.episode_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
         GROUP BY ct.topic_id
       )
       SELECT et.topic_id, COUNT(DISTINCT et.episode_id) as prior_episodes
        FROM episode_topics et
        JOIN current_topics current_topics ON current_topics.topic_id = et.topic_id
        JOIN episodes e ON et.episode_id = e.id
        WHERE e.published_date < ?
        GROUP BY et.topic_id`
    ).bind(episodeId, publishedDate).all(),
    topicIds.length > 1
      ? db.prepare(
          `WITH current_topics AS (
             SELECT ct.topic_id
             FROM chunk_topics ct
             JOIN chunks c ON ct.chunk_id = c.id
             JOIN topics t ON ct.topic_id = t.id
             WHERE c.episode_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
             GROUP BY ct.topic_id
           )
           SELECT ct1.topic_id as left_id, ct2.topic_id as right_id, COUNT(*) as corpus_count
            FROM chunk_topics ct1
            JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id < ct2.topic_id
            JOIN current_topics left_topics ON left_topics.topic_id = ct1.topic_id
            JOIN current_topics right_topics ON right_topics.topic_id = ct2.topic_id
            JOIN chunks c ON c.id = ct1.chunk_id
            JOIN topics t1 ON ct1.topic_id = t1.id
            JOIN topics t2 ON ct2.topic_id = t2.id
            WHERE c.episode_id != ?
              AND t1.hidden = 0 AND t1.display_suppressed = 0
              AND t2.hidden = 0 AND t2.display_suppressed = 0
             GROUP BY ct1.topic_id, ct2.topic_id`
        ).bind(episodeId, episodeId).all()
      : Promise.resolve({ results: [] as any[] }),
    previousEpisode
      ? db.prepare(
          `SELECT t.id, t.name, t.slug, t.distinctiveness, COUNT(*) as chunk_count
           FROM chunk_topics ct
           JOIN chunks c ON ct.chunk_id = c.id
           JOIN topics t ON ct.topic_id = t.id
           WHERE c.episode_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
           GROUP BY t.id`
        ).bind(previousEpisode.id).all()
      : Promise.resolve({ results: [] as any[] }),
  ]);

  const priorTopicCounts = new Map<number, number>();
  for (const row of priorTopicCountsResult.results as any[]) {
    priorTopicCounts.set(Number(row.topic_id), Number(row.prior_episodes));
  }

  const currentTopicMeta = new Map<number, { name: string; slug: string; chunkCount: number }>();
  for (const topic of currentTopics) {
    currentTopicMeta.set(Number(topic.id), {
      name: String(topic.name),
      slug: String(topic.slug),
      chunkCount: Number(topic.chunk_count),
    });
  }
  const currentTopicDistinctiveness = new Map<number, number>();
  for (const topic of currentTopics) {
    currentTopicDistinctiveness.set(Number(topic.id), Number(topic.distinctiveness ?? 0));
  }

  const chunkTopicRows = currentChunkTopicRowsResult.results as any[];
  const chunkTopicMap = new Map<number, { slug: string; title: string; position: number; topics: Array<{ id: number; name: string; slug: string }> }>();
  for (const row of chunkTopicRows) {
    const chunkId = Number(row.chunk_id);
    if (!chunkTopicMap.has(chunkId)) {
      chunkTopicMap.set(chunkId, {
        slug: String(row.chunk_slug),
        title: String(row.chunk_title),
        position: Number(row.position),
        topics: [],
      });
    }
    chunkTopicMap.get(chunkId)!.topics.push({
      id: Number(row.topic_id),
      name: String(row.topic_name),
      slug: String(row.topic_slug),
    });
  }

  const pairCorpusCounts = new Map<string, number>();
  for (const row of pairCorpusRowsResult.results as any[]) {
    pairCorpusCounts.set(`${row.left_id}:${row.right_id}`, Number(row.corpus_count));
  }

  const currentPairCounts = new Map<string, { leftId: number; rightId: number; chunkCount: number }>();
  for (const chunk of chunkTopicMap.values()) {
    const topicList = [...chunk.topics].sort((left, right) => left.id - right.id);
    for (let i = 0; i < topicList.length; i += 1) {
      for (let j = i + 1; j < topicList.length; j += 1) {
        const key = `${topicList[i].id}:${topicList[j].id}`;
        const current = currentPairCounts.get(key);
        currentPairCounts.set(key, {
          leftId: topicList[i].id,
          rightId: topicList[j].id,
          chunkCount: (current?.chunkCount ?? 0) + 1,
        });
      }
    }
  }

  const unexpectedPairings = [...currentPairCounts.values()]
    .map((pair) => {
      const left = currentTopicMeta.get(pair.leftId);
      const right = currentTopicMeta.get(pair.rightId);
      if (!left || !right) return null;
      return {
        leftName: left.name,
        leftSlug: left.slug,
        rightName: right.name,
        rightSlug: right.slug,
        chunkCount: pair.chunkCount,
        corpusCount: pairCorpusCounts.get(`${pair.leftId}:${pair.rightId}`) ?? 0,
      };
    })
    .filter((pair): pair is EpisodeUnexpectedPairing => pair !== null)
    .filter((pair) => pair.chunkCount >= 2)
    .sort((left: any, right: any) => left.corpusCount - right.corpusCount || right.chunkCount - left.chunkCount || `${left.leftName}${left.rightName}`.localeCompare(`${right.leftName}${right.rightName}`))
    .slice(0, 4) as EpisodeUnexpectedPairing[];

  const chunkNovelty = [...chunkTopicMap.values()]
    .map((chunk) => {
      const topicScores = chunk.topics.map((topic) => {
        const priorEpisodes = priorTopicCounts.get(topic.id) ?? 0;
        return Math.log((totalEpisodeCount + 1) / (priorEpisodes + 1));
      });
      const score = topicScores.length > 0
        ? topicScores.reduce((sum, value) => sum + value, 0) / topicScores.length
        : 0;
      return {
        slug: chunk.slug,
        title: chunk.title,
        position: chunk.position,
        score,
        topics: chunk.topics.map((topic) => ({ name: topic.name, slug: topic.slug })),
      };
    });

  const mostNovelChunks = [...chunkNovelty]
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, 4)
    .map(({ slug, title, score, topics }) => ({ slug, title, score, topics }));

  const previousTopics = new Map<number, { name: string; slug: string; chunkCount: number; distinctiveness: number }>();
  for (const row of previousTopicCountsResult.results as any[]) {
    previousTopics.set(Number(row.id), {
      name: String(row.name),
      slug: String(row.slug),
      chunkCount: Number(row.chunk_count),
      distinctiveness: Number(row.distinctiveness ?? 0),
    });
  }

  const newTopics = currentTopics
    .map((topic) => ({
      name: String(topic.name),
      slug: String(topic.slug),
      score: weightedTopicScore(Number(topic.chunk_count), Number(topic.distinctiveness ?? 0)),
      isNewToCorpus: (priorTopicCounts.get(Number(topic.id)) ?? 0) === 0,
    }))
    .filter((topic) => topic.isNewToCorpus)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map(({ name, slug }) => ({ name, slug }));

  const intensified = currentTopics
    .map((topic) => {
      const previous = previousTopics.get(Number(topic.id));
      const delta = Number(topic.chunk_count) - (previous?.chunkCount ?? 0);
      return {
        name: String(topic.name),
        slug: String(topic.slug),
        delta,
        score: weightedDeltaScore(delta, Number(topic.chunk_count), previous?.chunkCount ?? 0, Number(topic.distinctiveness ?? 0)),
      };
    })
    .filter((topic) => topic.delta > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map(({ name, slug, delta }) => ({ name, slug, delta }));

  const downshiftedCurrent = currentTopics
    .map((topic) => {
      const previous = previousTopics.get(Number(topic.id));
      const delta = Number(topic.chunk_count) - (previous?.chunkCount ?? 0);
      return {
        name: String(topic.name),
        slug: String(topic.slug),
        delta,
        score: weightedDeltaScore(delta, Number(topic.chunk_count), previous?.chunkCount ?? 0, Number(topic.distinctiveness ?? 0)),
      };
    })
    .filter((topic) => topic.delta < 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  const disappeared = [...previousTopics.entries()]
    .filter(([topicId]) => !currentTopicMeta.has(topicId))
    .map(([topicId, topic]) => ({
      name: topic.name,
      slug: topic.slug,
      delta: -topic.chunkCount,
      score: weightedDeltaScore(-topic.chunkCount, 0, topic.chunkCount, topic.distinctiveness),
    }));

  const downshifted = [...downshiftedCurrent, ...disappeared]
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map(({ name, slug, delta }) => ({ name, slug, delta }));

  const sinceLast: EpisodeSinceLast = {
    previousEpisode: previousEpisode || null,
    intensified,
    downshifted,
    newTopics,
  };

  return {
    unexpectedPairings,
    mostNovelChunks,
    sinceLast,
    archiveContrast,
  };
}

function weightedDeltaScore(delta: number, currentCount: number, previousCount: number, distinctiveness: number) {
  return Math.abs(delta) * weightedTopicScore(Math.max(currentCount, previousCount), distinctiveness);
}

function weightedTopicScore(count: number, distinctiveness: number) {
  return Math.log1p(Math.max(count, 1)) * (1 + Math.max(distinctiveness, 0) / 10);
}
