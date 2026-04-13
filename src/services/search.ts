import type { ParsedQuery } from "../lib/query-parser";
import { applyTopicFilter } from "./search-topics";

export interface BoostConfig {
  title: number;
  content: number;
}

export const DEFAULT_BOOSTS: BoostConfig = {
  title: 5.0,
  content: 1.0,
};

export interface ScoredResult {
  id: number;
  slug: string;
  score: number;
  source: "fts" | "vector";
  title?: string;
  episodeSlug?: string;
  episodeTitle?: string;
  publishedDate?: string;
  summary?: string;
  contentPlain?: string;
}

/**
 * Full-text search with date filters and exact phrase support.
 */
export async function ftsSearch(
  db: D1Database,
  parsed: ParsedQuery,
  limit: number = 20,
  boosts: BoostConfig = DEFAULT_BOOSTS
): Promise<ScoredResult[]> {
  // Build FTS query: combine text + exact phrases
  const parts: string[] = [];
  if (parsed.text.trim()) {
    const text = parsed.text.trim();
    // If the text already contains FTS5 operators (e.g. OR from entity alias
    // expansion), pass it through as-is so the operators aren't swallowed
    // inside a phrase literal. Otherwise wrap in quotes for phrase matching.
    if (/\bOR\b/.test(text)) {
      parts.push(text);
    } else {
      parts.push('"' + text.replace(/"/g, "") + '"');
    }
  }
  for (const phrase of parsed.phrases) {
    parts.push('"' + phrase.replace(/"/g, "") + '"');
  }
  const ftsQuery = parts.join(" ");
  if (!ftsQuery) return [];

  // Build date filter clauses
  const dateFilters: string[] = [];
  const dateBinds: any[] = [];
  if (parsed.before) {
    dateFilters.push("e.published_date <= ?");
    dateBinds.push(parsed.before);
  }
  if (parsed.after) {
    dateFilters.push("e.published_date >= ?");
    dateBinds.push(parsed.after);
  }
  if (parsed.year) {
    dateFilters.push("e.year = ?");
    dateBinds.push(parsed.year);
  }

  const dateWhere = dateFilters.length > 0
    ? "AND " + dateFilters.join(" AND ")
    : "";

  // Topic filter: resolve topic slugs to chunk IDs
  let topicWhere = "";
  let topicBinds: any[] = [];
  if (parsed.topics && parsed.topics.length > 0) {
    const allowedChunkIds = await applyTopicFilter(db, parsed.topics);
    if (allowedChunkIds.length === 0) return [];
    const placeholders = allowedChunkIds.map(() => "?").join(",");
    topicWhere = `AND c.id IN (${placeholders})`;
    topicBinds = allowedChunkIds;
  }

  const results = await db
    .prepare(
      `SELECT c.id, c.slug, c.title, c.summary, c.content_plain,
              e.slug as episode_slug, e.title as episode_title, e.published_date,
              bm25(chunks_fts, ?, ?) as rank
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN episodes e ON c.episode_id = e.id
       WHERE chunks_fts MATCH ?
       ${dateWhere}
       ${topicWhere}
       ORDER BY rank
       LIMIT ?`
    )
    .bind(-boosts.title, -boosts.content, ftsQuery, ...dateBinds, ...topicBinds, limit)
    .all();

  const rows = results.results as any[];
  if (rows.length === 0) return [];

  const minRank = Math.min(...rows.map((r) => r.rank));
  const maxRank = Math.max(...rows.map((r) => r.rank));
  const range = maxRank - minRank || 1;

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    contentPlain: r.content_plain,
    episodeSlug: r.episode_slug,
    episodeTitle: r.episode_title,
    publishedDate: r.published_date,
    score: (maxRank - r.rank) / range,
    source: "fts" as const,
  }));
}

/**
 * Merge and rerank results from FTS and vector search.
 */
export function mergeAndRerank(
  ftsResults: ScoredResult[],
  vectorResults: ScoredResult[],
  ftsWeight: number = 0.4,
  vectorWeight: number = 0.6
): ScoredResult[] {
  const combined = new Map<number, ScoredResult & { ftsScore: number; vecScore: number }>();

  for (const r of ftsResults) {
    combined.set(r.id, { ...r, ftsScore: r.score, vecScore: 0 });
  }

  for (const r of vectorResults) {
    const existing = combined.get(r.id);
    if (existing) {
      existing.vecScore = r.score;
      existing.score =
        existing.ftsScore * ftsWeight +
        r.score * vectorWeight +
        0.1;
      existing.source = "fts";
    } else {
      combined.set(r.id, { ...r, ftsScore: 0, vecScore: r.score });
    }
  }

  for (const [, item] of combined) {
    if (item.ftsScore > 0 && item.vecScore === 0) {
      item.score = item.ftsScore * ftsWeight;
    } else if (item.vecScore > 0 && item.ftsScore === 0) {
      item.score = item.vecScore * vectorWeight;
    }
  }

  return [...combined.values()].sort((a, b) => b.score - a.score);
}
