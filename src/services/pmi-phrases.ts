/**
 * PMI-based phrase extraction from chunk_words table.
 *
 * Pointwise Mutual Information measures how much more two words co-occur
 * than expected by chance:
 *   PMI(w1, w2) = log(P(w1, w2) / (P(w1) * P(w2)))
 *
 * High PMI = genuine collocation (e.g., "vibe coding").
 * Low PMI = independent words that happen to co-occur (e.g., "higher quality").
 */

export async function extractPMIPhrases(
  db: D1Database,
  minPMI: number = 3.0,
  minCooccurrence: number = 5,
  limit: number = 100
): Promise<{ phrase: string; pmi: number; coDocCount: number }[]> {
  const result = await db.prepare(`
    SELECT
      cw1.word || ' ' || cw2.word as phrase,
      COUNT(DISTINCT cw1.chunk_id) as co_doc_count,
      LN(
        CAST(COUNT(DISTINCT cw1.chunk_id) AS REAL) *
        (SELECT COUNT(*) FROM chunks) /
        (
          (SELECT COUNT(DISTINCT chunk_id) FROM chunk_words WHERE word = cw1.word) *
          (SELECT COUNT(DISTINCT chunk_id) FROM chunk_words WHERE word = cw2.word)
        )
      ) as pmi
    FROM chunk_words cw1
    JOIN chunk_words cw2 ON cw1.chunk_id = cw2.chunk_id
      AND cw1.word < cw2.word
      AND cw1.word != cw2.word
    WHERE cw1.count >= 1 AND cw2.count >= 1
    GROUP BY cw1.word, cw2.word
    HAVING co_doc_count >= ?
    ORDER BY pmi DESC
    LIMIT ?
  `).bind(minCooccurrence, limit).all();

  return result.results
    .filter((r: any) => r.pmi >= minPMI)
    .map((r: any) => ({
      phrase: r.phrase,
      pmi: r.pmi,
      coDocCount: r.co_doc_count,
    }));
}
