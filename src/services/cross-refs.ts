export interface CrossReference {
  vectorId: string;
  chunkId: number;
  title: string;
  score: number;
}

interface VectorMatch {
  id: string;
  score: number;
  metadata?: { chunkId?: number; title?: string } | null;
}

/**
 * Find cross-references: chunks that are semantically similar above a threshold.
 * These represent ideas that echo or build on each other across episodes.
 */
export function findCrossReferences(
  matches: VectorMatch[],
  selfVectorId: string,
  threshold: number = 0.75
): CrossReference[] {
  return matches
    .filter((m) => m.id !== selfVectorId && m.score >= threshold)
    .map((m) => ({
      vectorId: m.id,
      chunkId: (m.metadata?.chunkId as number) || 0,
      title: (m.metadata?.title as string) || "",
      score: m.score,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Query Vectorize for chunks similar to a given chunk,
 * then hydrate with D1 data.
 */
export async function getCrossReferences(
  vectorize: VectorizeIndex,
  db: D1Database,
  vectorId: string,
  chunkId: number,
  topK: number = 10,
  threshold: number = 0.75
): Promise<
  (CrossReference & {
    slug: string;
    episodeSlug: string;
    publishedDate: string;
  })[]
> {
  // Fetch the source vector
  const sourceVec = await vectorize.getByIds([vectorId]);
  if (!sourceVec.length) return [];

  const results = await vectorize.query(sourceVec[0].values, {
    topK,
    returnMetadata: "all",
  });

  const refs = findCrossReferences(results.matches, vectorId, threshold);
  if (!refs.length) return [];

  // Hydrate from D1
  const chunkIds = refs.map((r) => r.chunkId).filter((id) => id > 0);
  if (!chunkIds.length) return refs.map((r) => ({ ...r, slug: "", episodeSlug: "", publishedDate: "" }));

  const placeholders = chunkIds.map(() => "?").join(",");
  const hydrated = await db
    .prepare(
      `SELECT c.id, c.slug, e.slug as episode_slug, e.published_date
       FROM chunks c JOIN episodes e ON c.episode_id = e.id
       WHERE c.id IN (${placeholders})`
    )
    .bind(...chunkIds)
    .all();

  const hydMap = new Map(
    (hydrated.results as any[]).map((r) => [r.id, r])
  );

  return refs.map((r) => {
    const h = hydMap.get(r.chunkId);
    return {
      ...r,
      slug: h?.slug || "",
      episodeSlug: h?.episode_slug || "",
      publishedDate: h?.published_date || "",
    };
  });
}
