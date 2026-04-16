import {
  KeywordExtractor,
  defaultStopwordProvider,
  type CandidateFilterInput,
  type CandidateNormalizer,
  type KeywordExtractorOptions,
  type KeywordResult,
  type KeywordScorer,
  type StopwordProvider,
  type TextProcessor,
  extractYakeKeywords as extractYaketKeywords,
} from "@ade_oshineye/yaket/worker";
import { STOPWORDS } from "../lib/text";
import { slugify } from "../lib/slug";
import { normalizeChunkText, tokenizeNormalizedText } from "./analysis-text";
import { extractYakeKeywords as extractNaiveYakeKeywords } from "./yake";
import { isNoiseTopic, isWeakSingletonTopic } from "./topic-quality";

export type TopicExtractorMode = "naive" | "yaket" | "yaket_bobbin";

export interface YakeKeywordResult {
  keyword: string;
  score: number;
}

const BOBBIN_STOPWORD_ADDITIONS = new Set([
  "bits",
  "bobs",
  "really",
  "actually",
  "basically",
  "thing",
  "things",
  "stuff",
  "today",
  "yesterday",
  "tomorrow",
]);

const NO_STRIP = new Set([
  "llms", "process", "analysis", "basis", "crisis", "thesis",
  "diagnosis", "emphasis", "hypothesis", "synopsis", "atlas",
  "bus", "plus", "thus", "status", "focus", "bonus", "campus",
  "virus", "versus", "chaos", "canvas", "bias",
]);

const bobbinStopwordProvider: StopwordProvider = {
  load(language: string) {
    const base = defaultStopwordProvider.load(language);
    const merged = new Set(base);
    for (const stopword of STOPWORDS) merged.add(stopword.toLowerCase());
    for (const stopword of BOBBIN_STOPWORD_ADDITIONS) merged.add(stopword.toLowerCase());
    return merged;
  },
};

const bobbinTextProcessor: TextProcessor = {
  splitSentences(text: string) {
    const normalized = normalizeChunkText(text).normalizedText;
    return normalized.length === 0 ? [] : normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  },
  tokenizeWords(text: string) {
    return tokenizeNormalizedText(normalizeChunkText(text).normalizedText);
  },
};

const bobbinCandidateNormalizer: CandidateNormalizer = {
  normalize(token: string) {
    let normalized = normalizeChunkText(token).normalizedText
      .replace(/['"]/g, "")
      .replace(/[^a-zA-Z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (!normalized) return "";

    normalized = normalized
      .split(/\s+/)
      .map((word) => normalizeToken(word))
      .filter(Boolean)
      .join(" ")
      .trim();

    return normalized;
  },
};

const bobbinKeywordScorer: KeywordScorer = {
  score(candidates: KeywordResult[]) {
    return [...candidates]
      .map((candidate) => {
        let score = candidate.score;
        const sentenceSpread = new Set(candidate.sentenceIds).size;
        const weakSingleton = candidate.ngramSize === 1 && isWeakSingletonTopic(candidate.normalizedKeyword, candidate.occurrences, 0);

        if (candidate.ngramSize > 1) score *= 0.7;
        if (candidate.ngramSize >= 3) score *= 0.85;
        if (candidate.occurrences >= 2) score *= 0.85;
        if (sentenceSpread >= 2) score *= 0.85;
        if (sentenceSpread >= 3) score *= 0.9;
        if (weakSingleton) score *= 1.8;
        if (candidate.ngramSize === 1 && candidate.occurrences === 1) score *= 1.4;
        if (candidate.ngramSize === 1 && /(ed|ing|ment|ness|tion|sion|ance|ence)$/i.test(candidate.normalizedKeyword)) {
          score *= 1.35;
        }

        return { ...candidate, score };
      })
      .sort((left, right) => left.score - right.score || right.occurrences - left.occurrences || right.ngramSize - left.ngramSize);
  },
};

function normalizeToken(word: string): string {
  if (!word) return "";
  if (word.endsWith("'s") || word.endsWith("\u2019s")) word = word.slice(0, -2);
  if (word.endsWith("'") || word.endsWith("\u2019")) word = word.slice(0, -1);
  if (word.length <= 4) return word;
  if (NO_STRIP.has(word)) return word;
  if (word.endsWith("ies") && word.length > 5) return word.slice(0, -3) + "y";
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) return word.slice(0, -1);
  return word;
}

function bobbinCandidateFilter(candidate: CandidateFilterInput): boolean {
  const normalized = candidate.normalizedKeyword.trim().toLowerCase();
  if (!normalized) return false;
  if (isNoiseTopic(normalized)) return false;

  const slug = slugify(normalized);
  if (!slug || slug.length < 3) return false;
  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length === 0) return false;
  if (STOPWORDS.has(words[0]) || STOPWORDS.has(words[words.length - 1])) return false;
  if (words.some((word) => BOBBIN_STOPWORD_ADDITIONS.has(word))) return false;

  if (candidate.ngramSize === 1) {
    if (normalized.length < 5) return false;
    if (candidate.occurrences < 2) return false;
    if (candidate.sentenceIds.length < 2) return false;
    if (isWeakSingletonTopic(normalized, candidate.occurrences, 0)) return false;
  }

  if (candidate.ngramSize >= 2 && candidate.occurrences < 2 && candidate.score > 0.025) {
    return false;
  }

  return true;
}

const extractorCache = new Map<TopicExtractorMode, KeywordExtractor>();

function createBobbinYaketExtractor(): KeywordExtractor {
  const options: KeywordExtractorOptions = {
    lan: "en",
    dedupFunc: "jaro",
    dedupLim: 0.82,
    windowSize: 2,
    stopwordProvider: bobbinStopwordProvider,
    textProcessor: bobbinTextProcessor,
    candidateNormalizer: bobbinCandidateNormalizer,
    keywordScorer: bobbinKeywordScorer,
    candidateFilter: bobbinCandidateFilter,
  };
  return new KeywordExtractor(options);
}

function getCachedExtractor(mode: TopicExtractorMode): KeywordExtractor | null {
  if (mode !== "yaket_bobbin") return null;
  const existing = extractorCache.get(mode);
  if (existing) return existing;
  const created = createBobbinYaketExtractor();
  extractorCache.set(mode, created);
  return created;
}

export function normalizeTopicExtractorMode(mode?: string | null): TopicExtractorMode {
  if (mode === "yaket" || mode === "yaket_bobbin") return mode;
  return "naive";
}

export function extractRuntimeYakeKeywords(
  text: string,
  n: number = 5,
  maxNgram: number = 3,
  mode: TopicExtractorMode = "naive"
): YakeKeywordResult[] {
  if (mode === "naive") {
    return extractNaiveYakeKeywords(text, n, maxNgram);
  }

  if (mode === "yaket") {
    return extractYaketKeywords(text, n, maxNgram);
  }

  const extractor = getCachedExtractor(mode)!;
  extractor.config.top = n;
  extractor.config.n = maxNgram;
  return extractor.extractKeywordDetails(text).slice(0, n).map((candidate) => ({
    keyword: candidate.normalizedKeyword,
    score: candidate.score,
  }));
}
