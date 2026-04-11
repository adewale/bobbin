import type { ConcordanceRow } from "../types";

export async function getTopConcordance(
  db: D1Database,
  sortBy: "distinctive" | "count" = "distinctive",
  limit = 200
): Promise<ConcordanceRow[]> {
  const orderCol = sortBy === "count" ? "total_count" : "distinctiveness";
  const result = await db.prepare(
    `SELECT * FROM concordance
     WHERE doc_count >= 2 AND total_count >= 3 AND length(word) >= 4
     ORDER BY ${orderCol} DESC
     LIMIT ?`
  ).bind(limit).all<ConcordanceRow>();
  return result.results;
}

export async function getConcordanceWord(db: D1Database, word: string): Promise<ConcordanceRow | null> {
  return await db.prepare("SELECT * FROM concordance WHERE word = ?")
    .bind(word).first<ConcordanceRow>();
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
     JOIN chunk_tags ct ON c.id = ct.chunk_id
     JOIN tags t ON ct.tag_id = t.id
     JOIN episodes e ON c.episode_id = e.id
     GROUP BY c.id
     ORDER BY reach DESC
     LIMIT ?`
  ).bind(limit).all();
  return result.results;
}
