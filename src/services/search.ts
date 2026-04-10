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
  // Additional fields populated by hydration
  title?: string;
  episodeSlug?: string;
  episodeTitle?: string;
  publishedDate?: string;
  summary?: string;
  contentPlain?: string;
}

/**
 * Full-text search using FTS5 with configurable field boosting.
 * Uses bm25() for relevance scoring with per-column weight overrides.
 */
export async function ftsSearch(
  db: D1Database,
  query: string,
  limit: number = 20,
  boosts: BoostConfig = DEFAULT_BOOSTS
): Promise<ScoredResult[]> {
  if (!query.trim()) return [];

  // S3: Sanitize query to prevent FTS5 operator injection
  // Remove FTS5 operators by wrapping in double quotes (phrase search)
  const safeQuery = '"' + query.replace(/"/g, "") + '"';

  // FTS5 bm25() accepts negative weights per column: bm25(table, w0, w1, ...)
  // Lower (more negative) = higher boost. We negate our boost values.
  const results = await db
    .prepare(
      `SELECT c.id, c.slug, c.title, c.summary, c.content_plain,
              e.slug as episode_slug, e.title as episode_title, e.published_date,
              bm25(chunks_fts, ?, ?) as rank
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN episodes e ON c.episode_id = e.id
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .bind(-boosts.title, -boosts.content, safeQuery, limit)
    .all();

  // bm25 returns negative values where more negative = better match
  // Normalize to 0-1 range with best match = 1.0
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
    score: (maxRank - r.rank) / range, // normalize: best = 1.0
    source: "fts" as const,
  }));
}

/**
 * Merge and rerank results from FTS and vector search.
 *
 * Items appearing in both sets get a boost (Reciprocal Rank Fusion).
 * Final score = weighted combination of FTS and vector scores.
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
      // Appears in both — combine scores with a crossover boost
      existing.vecScore = r.score;
      existing.score =
        existing.ftsScore * ftsWeight +
        r.score * vectorWeight +
        0.1; // crossover bonus
      existing.source = "fts"; // keep FTS metadata (usually richer)
    } else {
      combined.set(r.id, { ...r, ftsScore: 0, vecScore: r.score });
    }
  }

  // Recompute scores for single-source items
  for (const [, item] of combined) {
    if (item.ftsScore > 0 && item.vecScore === 0) {
      item.score = item.ftsScore * ftsWeight;
    } else if (item.vecScore > 0 && item.ftsScore === 0) {
      item.score = item.vecScore * vectorWeight;
    }
  }

  return [...combined.values()].sort((a, b) => b.score - a.score);
}
