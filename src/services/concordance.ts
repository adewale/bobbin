import { tokenize } from "../lib/text";

export function tokenizeForConcordance(text: string): Map<string, number> {
  const words = tokenize(text);
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  return freq;
}

export async function updateConcordance(
  db: D1Database,
  chunkId: number,
  plainText: string
): Promise<void> {
  const wordCounts = tokenizeForConcordance(plainText);
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
  for (let i = 0; i < batch.length; i += 50) {
    await db.batch(batch.slice(i, i + 50));
  }
}

export async function rebuildConcordanceAggregates(
  db: D1Database
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM concordance"),
    db.prepare(`INSERT INTO concordance (word, total_count, doc_count, updated_at)
      SELECT word, SUM(count) as total_count, COUNT(DISTINCT chunk_id) as doc_count, datetime('now')
      FROM chunk_words GROUP BY word`),
  ]);
}
