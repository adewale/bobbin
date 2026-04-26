// Salience-weighted scoring for topic deltas. Used by both episode-level
// rail insights and period-level summary insights so the same intensified /
// downshifted / new-topic ranking applies whether the comparison window is
// "since last episode" or "since last month/year".

export function weightedTopicScore(count: number, distinctiveness: number): number {
  return Math.log1p(Math.max(count, 1)) * (1 + Math.max(distinctiveness, 0) / 10);
}

export function weightedDeltaScore(
  delta: number,
  currentCount: number,
  previousCount: number,
  distinctiveness: number,
): number {
  return Math.abs(delta) * weightedTopicScore(Math.max(currentCount, previousCount), distinctiveness);
}
