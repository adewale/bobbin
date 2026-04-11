import { readFileSync } from "node:fs";
import { STOPWORDS } from "../lib/text";

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

  try {
    const raw = readFileSync("data/english-top-1000.txt", "utf-8");
    const words = raw.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean);
    cachedBaseline = new Set(words);
    cachedBaselineRanks = new Map(words.map((w, i) => [w, i + 1]));
    return cachedBaseline;
  } catch {
    // Fallback: hardcoded top 200 English words
    cachedBaseline = new Set(STOPWORDS);
    cachedBaselineRanks = new Map();
    return cachedBaseline;
  }
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

/**
 * Detect Statistically Improbable Phrases (SIPs).
 *
 * Inspired by Amazon's SIP feature: multi-word phrases that appear
 * repeatedly in this corpus but would be rare in general English.
 * These characterize the author's distinctive vocabulary.
 *
 * We find bigrams that appear >= minCount times and whose constituent
 * words are both NOT in the top 200 most common English words.
 */
export function detectSIPs(
  texts: string[],
  minCount: number = 3
): SIPResult[] {
  const baseline = loadEnglishBaseline();
  const top200 = new Set(
    [...(cachedBaselineRanks?.entries() ?? [])]
      .filter(([, rank]) => rank <= 200)
      .map(([word]) => word)
  );

  const phraseCount = new Map<string, number>();
  const phraseDocCount = new Map<string, Set<number>>();

  for (let docIdx = 0; docIdx < texts.length; docIdx++) {
    const words = texts[docIdx]
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;

      // Skip if either word is a very common English word
      if (top200.has(words[i]) || top200.has(words[i + 1])) continue;
      // Skip if either word is a stopword
      if (STOPWORDS.has(words[i]) || STOPWORDS.has(words[i + 1])) continue;

      phraseCount.set(bigram, (phraseCount.get(bigram) || 0) + 1);
      if (!phraseDocCount.has(bigram)) phraseDocCount.set(bigram, new Set());
      phraseDocCount.get(bigram)!.add(docIdx);
    }
  }

  return [...phraseCount.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([phrase, count]) => ({
      phrase,
      count,
      docCount: phraseDocCount.get(phrase)?.size || 0,
    }))
    .sort((a, b) => b.count - a.count);
}
