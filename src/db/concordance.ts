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
