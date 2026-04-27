export function topicSupportThreshold(totalEpisodes: number): number {
  const safeEpisodes = Math.max(1, Math.floor(totalEpisodes));
  return Math.max(2, Math.ceil(Math.log2(safeEpisodes)));
}

export function quarterKeyFromIsoDate(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

function quarterOrdinal(quarterKey: string): number {
  const match = quarterKey.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return 0;
  return Number(match[1]) * 4 + (Number(match[2]) - 1);
}

export function enumerateQuarterKeys(startQuarter: string, endQuarter: string): string[] {
  const start = quarterOrdinal(startQuarter);
  const end = quarterOrdinal(endQuarter);
  if (start <= 0 || end <= 0 || end < start) return [];

  const keys: string[] = [];
  for (let value = start; value <= end; value += 1) {
    const year = Math.floor(value / 4);
    const quarter = (value % 4) + 1;
    keys.push(`${year}-Q${quarter}`);
  }
  return keys;
}

export function computeSpanAwareBurstScore(
  countsByQuarter: ReadonlyMap<string, number>,
  firstQuarter?: string | null,
  lastQuarter?: string | null,
): { score: number; peakQuarter: string | null; peakCount: number; spanQuarterCount: number } {
  if (!firstQuarter || !lastQuarter) {
    return { score: 1, peakQuarter: null, peakCount: 0, spanQuarterCount: 0 };
  }

  const span = enumerateQuarterKeys(firstQuarter, lastQuarter);
  if (span.length === 0) {
    return { score: 1, peakQuarter: null, peakCount: 0, spanQuarterCount: 0 };
  }

  let total = 0;
  let peakQuarter: string | null = null;
  let peakCount = 0;
  for (const quarter of span) {
    const count = countsByQuarter.get(quarter) ?? 0;
    total += count;
    if (count > peakCount || (count === peakCount && peakQuarter !== null && quarter < peakQuarter)) {
      peakQuarter = quarter;
      peakCount = count;
    }
    if (peakQuarter === null) {
      peakQuarter = quarter;
    }
  }

  if (total === 0) {
    return { score: 1, peakQuarter, peakCount: 0, spanQuarterCount: span.length };
  }

  const meanPerQuarter = total / span.length;
  return {
    score: peakCount / Math.max(meanPerQuarter, 1e-9),
    peakQuarter,
    peakCount,
    spanQuarterCount: span.length,
  };
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return null;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function blendTopicSimilarity(cosine: number | null, jaccard: number, alpha = 0.65): number {
  const boundedJaccard = Math.max(0, Math.min(1, jaccard));
  if (cosine === null) return boundedJaccard;
  const boundedCosine = Math.max(0, Math.min(1, cosine));
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  return boundedAlpha * boundedCosine + (1 - boundedAlpha) * boundedJaccard;
}

export function meanPoolVectors(vectors: readonly (readonly number[])[]): number[] | null {
  if (vectors.length === 0) return null;
  const width = vectors[0]?.length ?? 0;
  if (width === 0 || vectors.some((vector) => vector.length !== width)) return null;

  const sum = new Array<number>(width).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < width; index += 1) {
      sum[index] += vector[index] ?? 0;
    }
  }
  return sum.map((value) => value / vectors.length);
}
