import { STOPWORDS } from "../lib/text";
import { ENGLISH_BASELINE } from "../lib/english-baseline";

export interface DistinctivenessResult {
  word: string;
  corpusCount: number;
  corpusFreq: number; // frequency in corpus (0-1)
  baselineRank: number | null; // rank in English baseline (1=most common), null if absent
  distinctiveness: number; // ratio: higher = more distinctive to this corpus
}

export interface SIPResult {
  phrase: string;
  count: number;
  docCount: number;
}

let cachedBaseline: Set<string> | null = null;
let cachedBaselineRanks: Map<string, number> | null = null;

/**
 * Load the top-1000 English word frequency list as a baseline.
 * Words ranked higher (lower number) are more common in English.
 */
export function loadEnglishBaseline(): Set<string> {
  if (cachedBaseline) return cachedBaseline;
  cachedBaseline = new Set(ENGLISH_BASELINE);
  cachedBaselineRanks = new Map(ENGLISH_BASELINE.map((w, i) => [w, i + 1]));
  return cachedBaseline;
}

function getBaselineRank(word: string): number | null {
  if (!cachedBaselineRanks) loadEnglishBaseline();
  return cachedBaselineRanks?.get(word) ?? null;
}

/**
 * Compute distinctiveness scores for corpus words.
 *
 * Distinctiveness = how much more frequent a word is in this corpus
 * compared to general English. Words absent from the English baseline
 * (like "agentic", "llms") get the highest scores.
 *
 * Inspired by Amazon's Statistically Improbable Phrases: words/phrases
 * that appear significantly more in this text than in a reference corpus.
 *
 * Formula: distinctiveness = corpusFreq / expectedFreq
 * Where expectedFreq = 1 / (baselineRank * adjustmentFactor)
 * Words not in baseline get distinctiveness = corpusFreq * N * boost
 */
export function computeDistinctiveness(
  corpusFreq: Map<string, number>,
  totalWords: number,
  baseline: Set<string>
): DistinctivenessResult[] {
  const results: DistinctivenessResult[] = [];

  for (const [word, count] of corpusFreq) {
    if (STOPWORDS.has(word)) continue;
    if (word.length < 4) continue;

    const freq = count / totalWords;
    const rank = getBaselineRank(word);

    let distinctiveness: number;
    if (rank === null) {
      // Word not in top 1000 English — highly distinctive
      // Base score of 10 + bonus for frequency
      distinctiveness = 10 + (count * 0.1);
    } else {
      // Word is in top 1000 English — penalize by rank
      // Rank 1 = "the" (most common, least distinctive)
      // Rank 1000 = still common but less so
      const expectedFreq = 1 / (rank * 0.5); // rough expected frequency
      distinctiveness = freq / expectedFreq;
    }

    results.push({
      word,
      corpusCount: count,
      corpusFreq: freq,
      baselineRank: rank,
      distinctiveness,
    });
  }

  return results.sort((a, b) => b.distinctiveness - a.distinctiveness);
}

