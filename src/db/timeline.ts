import type { EpisodeRow } from "../types";

export async function getYears(db: D1Database) {
  const result = await db.prepare(
    "SELECT year, COUNT(*) as count FROM episodes GROUP BY year ORDER BY year DESC"
  ).all();
  return result.results as any[];
}

export async function getMonths(db: D1Database, year: number) {
  const result = await db.prepare(
    "SELECT month, COUNT(*) as count FROM episodes WHERE year = ? GROUP BY month ORDER BY month"
  ).bind(year).all();
  return result.results as any[];
}

export async function getEpisodesByMonth(db: D1Database, year: number, month: number): Promise<EpisodeRow[]> {
  const result = await db.prepare(
    "SELECT * FROM episodes WHERE year = ? AND month = ? ORDER BY published_date DESC"
  ).bind(year, month).all<EpisodeRow>();
  return result.results;
}
