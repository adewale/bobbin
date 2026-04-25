import type { ParsedQuery } from "../lib/query-parser";
import { escapeLike } from "../lib/html";
import { buildTopicChunkFilterClause } from "../services/search-topics";

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
  // For LIKE fallback, strip any FTS5 operators (OR) and quotes that the
  // entity alias expansion may have injected into parsed.text.
  let searchTerm = parsed.text || parsed.phrases[0] || "";
  // Remove FTS5 OR expressions — just keep the first meaningful term
  if (/\bOR\b/.test(searchTerm)) {
    searchTerm = searchTerm.split(/\s+OR\s+/)[0].replace(/"/g, "").trim();
  }
  if (!searchTerm) return [];

  const dateFilters: string[] = [];
  const binds: any[] = [`%${escapeLike(searchTerm)}%`];

  if (parsed.before) { dateFilters.push("e.published_date <= ?"); binds.push(parsed.before); }
  if (parsed.after) { dateFilters.push("e.published_date >= ?"); binds.push(parsed.after); }
  if (parsed.year) { dateFilters.push("e.year = ?"); binds.push(parsed.year); }

  const dateWhere = dateFilters.length > 0 ? "AND " + dateFilters.join(" AND ") : "";

  // Topic filter: resolve topic slugs to chunk IDs
  let topicWhere = "";
  const topicBinds: any[] = [];
  if (parsed.topics && parsed.topics.length > 0) {
    const topicFilter = buildTopicChunkFilterClause("c.id", parsed.topics);
    topicWhere = topicFilter.sql;
    topicBinds.push(...topicFilter.binds);
  }

  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c JOIN episodes e ON c.episode_id = e.id
     WHERE c.content_plain LIKE ? ESCAPE '\\'
     ${dateWhere}
     ${topicWhere}
     ORDER BY e.published_date DESC, c.position DESC, c.id DESC LIMIT ?`
   ).bind(...binds, ...topicBinds, limit).all<KeywordResult>();

  return result.results;
}
