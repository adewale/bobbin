import { tokenize } from "../lib/text";
import { decodeHtmlEntities } from "../lib/html";

async function batchExec(db: D1Database, stmts: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}

export function tokenizeForWordStats(text: string): Map<string, number> {
  const words = tokenize(decodeHtmlEntities(text));
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  return freq;
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
}
