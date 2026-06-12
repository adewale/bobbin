import type { ParsedQuery } from "../lib/query-parser";
import { sanitizeFtsQuery } from "../lib/html";
import { buildTopicChunkFilterClause } from "./search-topics";

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

export function buildParsedSearchFilterClause(
  parsed: Pick<ParsedQuery, "before" | "after" | "year" | "topics">,
  aliases: { episode: string; chunk: string } = { episode: "e", chunk: "c" }
): { sql: string; binds: unknown[] } {
  const filters: string[] = [];
  const binds: unknown[] = [];

  if (parsed.before) {
    filters.push(`${aliases.episode}.published_date <= ?`);
    binds.push(parsed.before);
  }
  if (parsed.after) {
    filters.push(`${aliases.episode}.published_date >= ?`);
    binds.push(parsed.after);
  }
  if (parsed.year) {
    filters.push(`${aliases.episode}.year = ?`);
    binds.push(parsed.year);
  }

  let sql = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
  if (parsed.topics && parsed.topics.length > 0) {
    const topicFilter = buildTopicChunkFilterClause(`${aliases.chunk}.id`, parsed.topics);
    sql = [sql, topicFilter.sql].filter(Boolean).join("\n       ");
    binds.push(...topicFilter.binds);
  }

  return { sql, binds };
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
  // Build FTS query: combine text + exact phrases. Every term reaches FTS5
  // as a quoted phrase literal so user input can never inject FTS grammar
  // (parens, NEAR, column filters).
  const parts: string[] = [];
  if (parsed.text.trim()) {
    const text = parsed.text.trim();
    // Preserve OR semantics (entity alias expansion and explicit user OR
    // queries) by quoting each disjunct individually instead of passing the
    // whole expression through raw.
    if (/\bOR\b/.test(text)) {
      const disjuncts = text
        .split(/\bOR\b/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => sanitizeFtsQuery(part));
      if (disjuncts.length > 0) parts.push(disjuncts.join(" OR "));
    } else {
      parts.push(sanitizeFtsQuery(text));
    }
  }
  for (const phrase of parsed.phrases) {
    parts.push(sanitizeFtsQuery(phrase));
  }
  const ftsQuery = parts.join(" ");
  if (!ftsQuery) return [];

  const filterClause = buildParsedSearchFilterClause(parsed);

  const results = await db
    .prepare(
      `SELECT c.id, c.slug, c.title, c.summary, c.content_plain,
              e.slug as episode_slug, e.title as episode_title, e.published_date,
              bm25(chunks_fts, ?, ?) as rank
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN episodes e ON c.episode_id = e.id
       WHERE chunks_fts MATCH ?
       ${filterClause.sql}
       ORDER BY rank, e.published_date DESC, c.position DESC, c.id DESC
       LIMIT ?`
    )
    .bind(-boosts.title, -boosts.content, ftsQuery, ...filterClause.binds, limit)
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
