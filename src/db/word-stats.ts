import type { WordStatsRow } from "../types";

export async function getTopWordStats(
  db: D1Database,
  sortBy: "distinctive" | "count" = "distinctive",
  limit = 200
): Promise<WordStatsRow[]> {
  const orderCol = sortBy === "count" ? "total_count" : "distinctiveness";
  const result = await db.prepare(
    `SELECT * FROM word_stats
     WHERE doc_count >= 2 AND total_count >= 3 AND length(word) >= 4
     ORDER BY ${orderCol} DESC
     LIMIT ?`
  ).bind(limit).all<WordStatsRow>();
  return result.results;
}

export async function getWordStats(db: D1Database, word: string): Promise<WordStatsRow | null> {
  return await db.prepare("SELECT * FROM word_stats WHERE word = ?")
    .bind(word).first<WordStatsRow>();
}

export async function getWordChunks(db: D1Database, word: string, limit = 100) {
  const result = await db.prepare(
    `SELECT c.*, cw.count as word_count_in_chunk,
            e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunk_words cw
     JOIN chunks c ON cw.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE cw.word = ?
     ORDER BY cw.count DESC, e.published_date DESC
     LIMIT ?`
  ).bind(word, limit).all();
  return result.results as any[];
}

export async function getWordTimeline(db: D1Database, word: string) {
  const result = await db.prepare(
    `SELECT e.published_date, e.title, SUM(cw.count) as episode_count
     FROM chunk_words cw
     JOIN chunks c ON cw.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE cw.word = ?
     GROUP BY e.id
     ORDER BY e.published_date ASC`
  ).bind(word).all();
  return result.results as any[];
}

export async function getSparklineDataForWords(db: D1Database, words: string[]) {
  if (!words.length) return new Map<string, number[]>();

  const placeholders = words.map(() => "?").join(",");
  const timeline = await db.prepare(
    `SELECT cw.word, e.published_date, SUM(cw.count) as ep_count
     FROM chunk_words cw
     JOIN chunks c ON cw.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE cw.word IN (${placeholders})
     GROUP BY cw.word, e.id
     ORDER BY e.published_date ASC`
  ).bind(...words).all();

  const allDates = [...new Set((timeline.results as any[]).map((r) => r.published_date))].sort();
  const dateIdx = new Map(allDates.map((d, i) => [d, i]));

  const sparklineData = new Map<string, number[]>();
  for (const word of words) {
    const points = new Array(allDates.length).fill(0);
    for (const r of timeline.results as any[]) {
      if (r.word === word) {
        points[dateIdx.get(r.published_date)!] = r.ep_count;
      }
    }
    sparklineData.set(word, points);
  }

  return sparklineData;
}

export async function getMostConnected(db: D1Database, limit = 8) {
  // Try precomputed reach first; fall back to computed if no reach data
  const hasReach = await db.prepare(
    "SELECT COUNT(*) as c FROM chunks WHERE reach > 0"
  ).first<{ c: number }>();

  if (hasReach && hasReach.c > 0) {
    const result = await db.prepare(
      `SELECT c.id, c.slug, c.title, c.reach,
              e.slug as episode_slug, e.published_date
       FROM chunks c
       JOIN episodes e ON c.episode_id = e.id
       WHERE c.reach > 0
       ORDER BY c.reach DESC
       LIMIT ?`
    ).bind(limit).all();
    return result.results;
  }

  // Fallback: compute on the fly (slower but works without enrichment)
  const result = await db.prepare(
    `SELECT c.id, c.slug, c.title,
            e.slug as episode_slug, e.published_date,
            SUM(t.usage_count) as reach
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN topics t ON ct.topic_id = t.id
     JOIN episodes e ON c.episode_id = e.id
     GROUP BY c.id
     ORDER BY reach DESC
     LIMIT ?`
  ).bind(limit).all();
  return result.results;
}
