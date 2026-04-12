import type { ParsedQuery } from "../lib/query-parser";
import { escapeLike } from "../lib/html";

export interface KeywordResult {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  content_plain: string;
  episode_slug: string;
  episode_title: string;
  published_date: string;
}

/**
 * Fallback keyword search using LIKE (when FTS is unavailable).
 */
export async function keywordSearch(
  db: D1Database,
  parsed: ParsedQuery,
  limit: number = 20
): Promise<KeywordResult[]> {
  const searchTerm = parsed.text || parsed.phrases[0] || "";
  if (!searchTerm) return [];

  const dateFilters: string[] = [];
  const binds: any[] = [`%${escapeLike(searchTerm)}%`];

  if (parsed.before) { dateFilters.push("e.published_date < ?"); binds.push(parsed.before); }
  if (parsed.after) { dateFilters.push("e.published_date > ?"); binds.push(parsed.after); }
  if (parsed.year) { dateFilters.push("e.year = ?"); binds.push(parsed.year); }

  const dateWhere = dateFilters.length > 0 ? "AND " + dateFilters.join(" AND ") : "";

  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c JOIN episodes e ON c.episode_id = e.id
     WHERE c.content_plain LIKE ? ESCAPE '\\'
     ${dateWhere}
     ORDER BY e.published_date DESC LIMIT ?`
  ).bind(...binds, limit).all<KeywordResult>();

  return result.results;
}
