import {
  KeywordExtractor,
  createStaticStopwordProvider,
  createStopwordSet,
  type CandidateFilterInput,
  type CandidateNormalizer,
  type KeywordExtractorOptions,
  type KeywordResult,
  type KeywordScorer,
  type MultiWordScorer,
  type SingleWordScorer,
  type TextProcessor,
  extractYakeKeywords as extractYaketKeywords,
} from "@ade_oshineye/yaket/worker";
import { STOPWORDS } from "../lib/text";
import { slugify } from "../lib/slug";
import { normalizeChunkText, tokenizeNormalizedText } from "./analysis-text";
import { extractYakeKeywords as extractNaiveYakeKeywords } from "./yake";
import { isNoiseTopic, isWeakSingletonTopic } from "./topic-quality";

export type TopicExtractorMode = "naive" | "yaket" | "yaket_bobbin" | "episode_hybrid";

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

const bobbinStopwordProvider = createStaticStopwordProvider({
  en: createStopwordSet("en", {
    add: [...STOPWORDS, ...BOBBIN_STOPWORD_ADDITIONS],
  }),
});

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

const bobbinSingleWordScorer: SingleWordScorer = {
  score(term, context) {
    term.updateH(context, context.features);
    let score = term.h;
    const normalized = term.uniqueTerm;
    const occurrences = term.tf;
    const sentenceSpread = term.occurs.size;

    if (isWeakSingletonTopic(normalized, occurrences, 0)) score *= 1.8;
    if (occurrences === 1) score *= 1.35;
    if (sentenceSpread === 1) score *= 1.25;
    if (/(ed|ing|ment|ness|tion|sion|ance|ence)$/i.test(normalized)) score *= 1.2;
    if (normalized.length >= 8 && occurrences >= 2 && sentenceSpread >= 2) score *= 0.9;

    return score;
  },
};

const bobbinMultiWordScorer: MultiWordScorer = {
  score(candidate, context) {
    candidate.updateH(context.features);
    let score = candidate.h;

    if (candidate.size >= 2) score *= 0.8;
    if (candidate.size === 2) score *= 0.9;
    if (candidate.size >= 4) score *= 1.1;
    if (candidate.tf >= 2) score *= 0.85;
    if (candidate.tf >= 3) score *= 0.9;
    if (candidate.uniqueKw.split(/\s+/).some((word) => BOBBIN_STOPWORD_ADDITIONS.has(word))) score *= 1.5;

    return score;
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
    language: "en",
    dedupFunc: "jaro",
    dedupLim: 0.82,
    windowSize: 2,
    stopwordProvider: bobbinStopwordProvider,
    textProcessor: bobbinTextProcessor,
    candidateNormalizer: bobbinCandidateNormalizer,
    singleWordScorer: bobbinSingleWordScorer,
    multiWordScorer: bobbinMultiWordScorer,
    keywordScorer: bobbinKeywordScorer,
    candidateFilter: bobbinCandidateFilter,
  };
  return new KeywordExtractor(options);
}

function getCachedExtractor(mode: TopicExtractorMode): KeywordExtractor | null {
  if (mode !== "yaket_bobbin" && mode !== "episode_hybrid") return null;
  const existing = extractorCache.get(mode);
  if (existing) return existing;
  const created = createBobbinYaketExtractor();
  extractorCache.set(mode, created);
  return created;
}

export function normalizeTopicExtractorMode(mode?: string | null): TopicExtractorMode {
  if (mode === "yaket" || mode === "yaket_bobbin" || mode === "episode_hybrid") return mode;
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
