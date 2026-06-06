export type WordStatsPeriod = {
  periodType: "year" | "month";
  periodKey: string;
};

export async function rebuildWordStatsPeriods(db: D1Database): Promise<number> {
  await db.prepare("DELETE FROM word_stats_period").run();
  await db.prepare(
    `INSERT INTO word_stats_period (period_type, period_key, word, total_count, doc_count, updated_at)
     SELECT 'year', CAST(e.year AS TEXT), cw.word, SUM(cw.count), COUNT(DISTINCT cw.chunk_id), datetime('now')
     FROM chunk_words cw
     JOIN chunks c ON cw.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     GROUP BY e.year, cw.word`
  ).run();
  await db.prepare(
    `INSERT INTO word_stats_period (period_type, period_key, word, total_count, doc_count, updated_at)
     SELECT 'month', substr(e.published_date, 1, 7), cw.word, SUM(cw.count), COUNT(DISTINCT cw.chunk_id), datetime('now')
     FROM chunk_words cw
     JOIN chunks c ON cw.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     GROUP BY substr(e.published_date, 1, 7), cw.word`
  ).run();
  const count = await db.prepare("SELECT COUNT(*) as c FROM word_stats_period").first<{ c: number }>();
  return count?.c ?? 0;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function lastDayOfMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

export function detectWordStatsPeriod(from: string | undefined, to: string | undefined): WordStatsPeriod | null {
  if (!from || !to) return null;

  const yearMatch = /^(\d{4})-01-01$/.exec(from);
  if (yearMatch && to === `${yearMatch[1]}-12-31`) {
    return { periodType: "year", periodKey: yearMatch[1] };
  }

  const monthMatch = /^(\d{4})-(\d{2})-01$/.exec(from);
  if (!monthMatch) return null;
  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const expectedTo = `${monthMatch[1]}-${monthMatch[2]}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;
  return to === expectedTo ? { periodType: "month", periodKey: `${monthMatch[1]}-${monthMatch[2]}` } : null;
}
