import { batchExec } from "../lib/db";
import { countTokenFrequencies, normalizeChunkText, tokenizeNormalizedText } from "./analysis-text";
import { computeDistinctiveness, loadEnglishBaseline } from "./distinctiveness";

export function tokenizeForWordStats(text: string): Map<string, number> {
  const normalized = normalizeChunkText(text);
  return countTokenFrequencies(tokenizeNormalizedText(normalized.normalizedText));
}

export async function updateWordStats(
  db: D1Database,
  chunkId: number,
  plainText: string
): Promise<void> {
  const wordCounts = tokenizeForWordStats(plainText);
  if (wordCounts.size === 0) return;

  const batch: D1PreparedStatement[] = [];

  for (const [word, count] of wordCounts) {
    batch.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO chunk_words (chunk_id, word, count) VALUES (?, ?, ?)"
        )
        .bind(chunkId, word, count)
    );
  }

  // Process in batches of 50 to stay within D1 limits
  await batchExec(db, batch);
}

export async function rebuildWordStatsAggregates(
  db: D1Database
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM word_stats WHERE word NOT IN (SELECT DISTINCT word FROM chunk_words)"),
    db.prepare(`INSERT INTO word_stats (word, total_count, doc_count, updated_at)
      SELECT word, SUM(count) as total_count, COUNT(DISTINCT chunk_id) as doc_count, datetime('now')
      FROM chunk_words GROUP BY word
      ON CONFLICT(word) DO UPDATE SET
        total_count = excluded.total_count,
        doc_count = excluded.doc_count,
        updated_at = excluded.updated_at`),
  ]);

  const rows = await db.prepare(
    "SELECT word, total_count FROM word_stats"
  ).all<{ word: string; total_count: number }>();
  const corpusFreq = new Map<string, number>();
  let totalWords = 0;
  for (const row of rows.results) {
    corpusFreq.set(row.word, row.total_count);
    totalWords += row.total_count;
  }

  const baseline = loadEnglishBaseline();
  const distinctiveness = computeDistinctiveness(corpusFreq, Math.max(totalWords, 1), baseline);
  const scoredWords = new Set(distinctiveness.map((row) => row.word));
  const updates = distinctiveness.map((row) =>
    db.prepare(
      `UPDATE word_stats
       SET distinctiveness = ?, in_baseline = ?, updated_at = datetime('now')
       WHERE word = ?`
    ).bind(row.distinctiveness, baseline.has(row.word) ? 1 : 0, row.word)
  );
  for (const row of rows.results) {
    if (scoredWords.has(row.word)) continue;
    updates.push(
      db.prepare(
        `UPDATE word_stats
         SET distinctiveness = 0, in_baseline = ?, updated_at = datetime('now')
         WHERE word = ?`
      ).bind(baseline.has(row.word) ? 1 : 0, row.word)
    );
  }
  if (updates.length > 0) {
    await batchExec(db, updates);
  }
}
