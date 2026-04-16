import { STOPWORDS } from "../lib/text";
import { slugify } from "../lib/slug";
import { escapeRegex } from "../lib/html";
import { isNoiseTopic } from "./topic-quality";
import { KNOWN_ENTITIES } from "../data/known-entities";
import { extractRuntimeYakeKeywords, type TopicExtractorMode } from "./yake-runtime";
import {
  type ChunkTextArtifact,
  normalizeChunkText,
  tokenizeNormalizedText,
} from "./analysis-text";
import { extractCorpusNgrams } from "./ngram-extractor";

export { normalizeChunkText } from "./analysis-text";

// Words where trailing 's' is part of the word, not a plural
const NO_STRIP = new Set([
  "llms", "process", "analysis", "basis", "crisis", "thesis",
  "diagnosis", "emphasis", "hypothesis", "synopsis", "atlas",
  "bus", "plus", "thus", "status", "focus", "bonus", "campus",
  "virus", "versus", "chaos", "canvas", "bias",
]);

const ENTITY_SKIP = new Set([
  "thats", "theres", "theyre", "theyll", "theyd", "theyve",
  "heres", "whats", "whos", "its", "ive", "youre", "youve", "youll",
  "dont", "doesnt", "didnt", "cant", "wont", "shouldnt", "wouldnt", "couldnt",
  "once", "instead", "sometimes", "another", "similar", "however", "therefore",
  "although", "meanwhile", "furthermore", "moreover", "nevertheless",
  "perhaps", "certainly", "basically", "essentially", "generally",
  "typically", "actually", "probably", "obviously", "unfortunately",
  "first", "second", "third", "next", "last", "also", "still", "already",
  "every", "each", "both", "either", "neither", "several", "many", "most",
  "some", "other", "such", "same", "more", "less", "much", "very",
]);

const SOURCE_PRIORITY: Record<CandidateSource, number> = {
  known_entity: 4,
  phrase_lexicon: 3,
  heuristic_entity: 2,
  yake: 1,
};

export interface TopicResult {
  name: string;
  slug: string;
  score?: number;
  kind?: "concept" | "entity" | "phrase";
}

export interface CorpusStats {
  totalChunks: number;
  docFreq: Map<string, number>;
}

export type CandidateSource = "known_entity" | "heuristic_entity" | "phrase_lexicon" | "yake";

export interface TopicCandidate {
  chunkId: number;
  source: CandidateSource;
  rawCandidate: string;
  normalizedCandidate: string;
  name: string;
  slug: string;
  score: number;
  kind: "concept" | "entity" | "phrase";
  provenance: string[];
}

export interface CandidateDecision extends TopicCandidate {
  decision: "accepted" | "rejected";
  decisionReason: string;
}

export interface PhraseLexiconEntry {
  phrase: string;
  normalizedName: string;
  slug: string;
  supportCount: number;
  docCount: number;
  qualityScore: number;
  provenance: string;
}

export interface PhraseDiscoveryDocument {
  chunkId: number;
  normalizedText: string;
  tokens: string[];
}

/**
 * Normalize a term: lowercase + strip simple plurals.
 * "systems" -> "system", "Grubby Truffles" -> "grubby truffle"
 */
export function normalizeTerm(term: string): string {
  let normalized = normalizeChunkText(term).normalizedText
    .replace(/['"]/g, "")
    .replace(/([a-z0-9])-(?=[a-z0-9])/gi, "$1 ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) return "";

  if (normalized.includes(" ")) {
    return normalized.split(/\s+/).map((word) => normalizeSingleWord(word)).join(" ");
  }

  return normalizeSingleWord(normalized);
}

function normalizeSingleWord(word: string): string {
  if (word.endsWith("'s") || word.endsWith("\u2019s")) {
    word = word.slice(0, -2);
  }
  if (word.endsWith("'") || word.endsWith("\u2019")) {
    word = word.slice(0, -1);
  }

  if (word.length <= 4) return word;
  if (NO_STRIP.has(word)) return word;

  if (word.endsWith("ies") && word.length > 5) {
    return word.slice(0, -3) + "y";
  }

  if (
    word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes") ||
    word.endsWith("ches") || word.endsWith("shes")
  ) {
    return word.slice(0, -2);
  }

  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }

  return word;
}

/**
 * Pre-compute document frequency across the entire corpus.
 * Call once with all chunk plain texts; pass the result to extractTopics.
 */
export function computeCorpusStats(allChunkTexts: string[]): CorpusStats {
  const docFreq = new Map<string, number>();
  for (const text of allChunkTexts) {
    const uniqueWords = new Set(tokenizeNormalizedText(normalizeChunkText(text).normalizedText));
    for (const word of uniqueWords) {
      docFreq.set(word, (docFreq.get(word) || 0) + 1);
    }
  }
  return { totalChunks: allChunkTexts.length, docFreq };
}

function buildBoundaryRegex(form: string): RegExp {
  const escaped = escapeRegex(form.toLowerCase());
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i");
}

function sanitizeEntityToken(word: string): string {
  return word
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9'\-]+$/g, "")
    .replace(/['\u2018\u2019]s$/i, "")
    .replace(/['\u2018\u2019]$/i, "");
}

function isCapitalizedToken(word: string): boolean {
  if (word.length < 2) return false;
  const first = word[0];
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

function rankCandidate(candidate: TopicCandidate): number {
  if (candidate.source === "yake") {
    return SOURCE_PRIORITY[candidate.source] * 1_000_000 - candidate.score;
  }
  return SOURCE_PRIORITY[candidate.source] * 1_000_000 + candidate.score;
}

export function canonicalizeTopicCandidate(candidate: TopicCandidate): TopicCandidate {
  const canonicalName = candidate.kind === "entity"
    ? candidate.name
    : normalizeTerm(candidate.normalizedCandidate || candidate.rawCandidate);
  const canonicalSlug = slugify(canonicalName);
  return {
    ...candidate,
    normalizedCandidate: canonicalName,
    name: canonicalName,
    slug: canonicalSlug,
  };
}

export function rejectTopicCandidate(candidate: TopicCandidate): string | null {
  if (!candidate.normalizedCandidate) return "empty_candidate";
  if (!candidate.slug) return "empty_slug";
  if (!/^[a-z0-9-]+$/.test(candidate.slug)) return "malformed_slug";
  if (candidate.slug.length < 3) return "short_slug";

  const words = candidate.normalizedCandidate.split(/\s+/).filter(Boolean);
  if (candidate.kind !== "entity" && words.length === 0) return "empty_candidate";
  if (candidate.kind !== "entity" && words.length === 1 && words[0].length < 4) return "ultra_short_singleton";
  if (candidate.kind !== "entity" && words.length === 1 && STOPWORDS.has(words[0])) return "stopword_singleton";
  if (candidate.kind !== "entity" && words.length > 1) {
    if (STOPWORDS.has(words[0]) || STOPWORDS.has(words[words.length - 1])) {
      return "filler_phrase_boundary";
    }
  }
  if (candidate.kind !== "entity" && isNoiseTopic(candidate.normalizedCandidate)) return "noise_candidate";

  return null;
}

function toTopicResult(candidate: TopicCandidate): TopicResult {
  return {
    name: candidate.name,
    slug: candidate.slug,
    score: candidate.score,
    kind: candidate.kind,
  };
}

export function extractKnownEntityCandidates(
  artifact: ChunkTextArtifact,
  chunkId: number
): TopicCandidate[] {
  const lowerText = artifact.normalizedText.toLowerCase();
  const results: TopicCandidate[] = [];
  const seenNames = new Set<string>();

  for (const entity of KNOWN_ENTITIES) {
    if (seenNames.has(entity.name)) continue;

    const aliases = entity.aliases || [];
    const allForms = [entity.name.toLowerCase(), ...aliases.map((alias) => alias.toLowerCase())];
    const matchedForm = allForms.find((form) => buildBoundaryRegex(form).test(lowerText));
    if (!matchedForm) continue;

    seenNames.add(entity.name);
    results.push({
      chunkId,
      source: "known_entity",
      rawCandidate: matchedForm,
      normalizedCandidate: normalizeTerm(entity.name),
      name: entity.name,
      slug: slugify(entity.name),
      score: 200,
      kind: "entity",
      provenance: [`matched_alias:${matchedForm}`, "boundary_aware_match"],
    });
  }

  return results;
}

export function extractHeuristicEntityCandidates(
  artifact: ChunkTextArtifact,
  chunkId: number
): TopicCandidate[] {
  const entities: TopicCandidate[] = [];
  const seen = new Set<string>();
  const sentences = artifact.normalizedText.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length < 1) continue;

    let i = 0;
    while (i < words.length) {
      const current = sanitizeEntityToken(words[i]);
      if (!isCapitalizedToken(current)) {
        i++;
        continue;
      }

      const entityWords = [current];
      let j = i + 1;
      while (j < words.length) {
        const next = sanitizeEntityToken(words[j]);
        if (!isCapitalizedToken(next)) break;
        entityWords.push(next);
        j++;
      }

      const entityName = entityWords.join(" ");
      const normalized = normalizeTerm(entityName);
      const firstWordLower = entityWords[0].toLowerCase();
      const atSentenceStart = i === 0;

      if (!normalized || STOPWORDS.has(firstWordLower) || ENTITY_SKIP.has(firstWordLower)) {
        i = j;
        continue;
      }

      if (entityWords.length >= 2 && entityWords.length <= 3 && !seen.has(normalized)) {
        seen.add(normalized);
        entities.push({
          chunkId,
          source: "heuristic_entity",
          rawCandidate: entityName,
          normalizedCandidate: normalized,
          name: normalized,
          slug: slugify(normalized),
          score: 100,
          kind: "concept",
          provenance: [atSentenceStart ? "sentence_start_multiword" : "mid_sentence_multiword", `token_count:${entityWords.length}`],
        });
      } else if (
        entityWords.length === 1 &&
        !atSentenceStart &&
        normalized.length > 3 &&
        !STOPWORDS.has(normalized) &&
        !ENTITY_SKIP.has(normalized) &&
        !seen.has(normalized)
      ) {
        seen.add(normalized);
        entities.push({
          chunkId,
          source: "heuristic_entity",
          rawCandidate: entityName,
          normalizedCandidate: normalized,
          name: normalized,
          slug: slugify(normalized),
          score: 100,
          kind: "concept",
          provenance: ["mid_sentence_single_capitalized", "token_count:1"],
        });
      }

      i = j;
    }
  }

  return entities;
}

function extractPhraseLexiconCandidates(
  artifact: ChunkTextArtifact,
  chunkId: number,
  phraseLexicon: PhraseLexiconEntry[]
): TopicCandidate[] {
  const lowerText = artifact.normalizedText.toLowerCase();
  const results: TopicCandidate[] = [];

  for (const phrase of phraseLexicon) {
    if (!buildBoundaryRegex(phrase.normalizedName).test(lowerText)) continue;
    results.push({
      chunkId,
      source: "phrase_lexicon",
      rawCandidate: phrase.phrase,
      normalizedCandidate: phrase.normalizedName,
      name: phrase.normalizedName,
      slug: phrase.slug,
      score: phrase.qualityScore,
      kind: "phrase",
      provenance: [phrase.provenance, `support_count:${phrase.supportCount}`, `doc_count:${phrase.docCount}`],
    });
  }

  return results;
}

function extractYakeCandidates(
  artifact: ChunkTextArtifact,
  chunkId: number,
  maxTopics: number,
  extractorMode: TopicExtractorMode
): TopicCandidate[] {
  return extractRuntimeYakeKeywords(artifact.normalizedText, maxTopics * 2, 3, extractorMode)
    .map((kw) => {
      const normalizedCandidate = normalizeTerm(kw.keyword);
      return {
        chunkId,
        source: "yake" as const,
        rawCandidate: kw.keyword,
        normalizedCandidate,
        name: normalizedCandidate,
        slug: slugify(normalizedCandidate),
        score: kw.score,
        kind: "concept" as const,
        provenance: [`yake_score:${kw.score.toFixed(6)}`],
      };
    })
    .filter((candidate) => candidate.normalizedCandidate.length > 0);
}

export function extractTopicCandidates(
  artifact: ChunkTextArtifact,
  chunkId: number,
  maxTopics: number = 5,
  phraseLexicon: PhraseLexiconEntry[] = [],
  extractorMode: TopicExtractorMode = "naive"
): TopicCandidate[] {
  return [
    ...extractKnownEntityCandidates(artifact, chunkId),
    ...extractHeuristicEntityCandidates(artifact, chunkId),
    ...extractPhraseLexiconCandidates(artifact, chunkId, phraseLexicon),
    ...extractYakeCandidates(artifact, chunkId, maxTopics, extractorMode),
  ].map(canonicalizeTopicCandidate);
}

export function buildPhraseLexicon(
  textsOrDocuments: string[] | PhraseDiscoveryDocument[]
): PhraseLexiconEntry[] {
  const documents: PhraseDiscoveryDocument[] = textsOrDocuments.map((entry, index) => {
    if (typeof entry === "string") {
      const normalizedText = normalizeChunkText(entry).normalizedText;
      return {
        chunkId: index,
        normalizedText,
        tokens: tokenizeNormalizedText(normalizedText),
      };
    }
    return {
      chunkId: entry.chunkId,
      normalizedText: entry.normalizedText,
      tokens: entry.tokens,
    };
  }).filter((entry) => entry.normalizedText.length > 0);

  if (documents.length < 2) return [];

  const minDocs = documents.length >= 10 ? 3 : 2;
  const docCountByWord = new Map<string, number>();
  for (const document of documents) {
    const seen = new Set(document.tokens);
    for (const token of seen) {
      docCountByWord.set(token, (docCountByWord.get(token) || 0) + 1);
    }
  }

  const bigramStats = new Map<string, { supportCount: number; docIds: Set<number>; words: [string, string] }>();
  for (const document of documents) {
    for (let i = 0; i < document.tokens.length - 1; i++) {
      const first = document.tokens[i];
      const second = document.tokens[i + 1];
      if (STOPWORDS.has(first) || STOPWORDS.has(second)) continue;
      const phrase = `${first} ${second}`;
      const stats = bigramStats.get(phrase) || { supportCount: 0, docIds: new Set<number>(), words: [first, second] };
      stats.supportCount += 1;
      stats.docIds.add(document.chunkId);
      bigramStats.set(phrase, stats);
    }
  }

  const bigramEntries = [...bigramStats.entries()]
    .map(([phrase, stats]) => {
      const docCount = stats.docIds.size;
      if (docCount < minDocs) return null;
      const denom = (docCountByWord.get(stats.words[0]) || 1) * (docCountByWord.get(stats.words[1]) || 1);
      const pmi = Math.log((docCount * documents.length) / Math.max(denom, 1));
      const normalizedName = normalizeTerm(phrase);
      const qualityScore = Math.max(0, pmi) * (1 + Math.log2(stats.supportCount + 1));
      return {
        phrase: normalizedName,
        normalizedName,
        slug: slugify(normalizedName),
        supportCount: stats.supportCount,
        docCount,
        qualityScore,
        provenance: "adjacent_pmi_bigram",
      };
    })
    .filter((entry): entry is PhraseLexiconEntry => entry !== null)
    .filter((entry) => entry.qualityScore > 0 && entry.slug.length >= 3 && !isNoiseTopic(entry.normalizedName));

  const fallbackNgrams = extractCorpusNgrams(
    documents.map((document) => document.normalizedText),
    minDocs,
    minDocs
  ).map((ngram) => {
    const normalizedName = normalizeTerm(ngram.phrase);
    return {
      phrase: normalizedName,
      normalizedName,
      slug: slugify(normalizedName),
      supportCount: ngram.count,
      docCount: ngram.docCount,
      qualityScore: ngram.count * ngram.docCount,
      provenance: "corpus_ngram_fallback",
    };
  }).filter((entry) => entry.slug.length >= 3 && !isNoiseTopic(entry.normalizedName));

  const merged = new Map<string, PhraseLexiconEntry>();
  for (const entry of [...bigramEntries, ...fallbackNgrams]) {
    const existing = merged.get(entry.slug);
    if (!existing || existing.qualityScore < entry.qualityScore) {
      merged.set(entry.slug, entry);
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.qualityScore - a.qualityScore || b.docCount - a.docCount)
    .slice(0, 200);
}

export function identifyDistinctiveEntities(
  wordStats: { word: string; distinctiveness: number; in_baseline: number }[]
): string[] {
  return wordStats
    .filter((word) => word.distinctiveness >= 15 && word.in_baseline === 0 && word.word.length >= 4)
    .map((word) => word.word);
}

export function extractEntities(text: string): TopicResult[] {
  return extractHeuristicEntityCandidates(normalizeChunkText(text), 0).map((candidate) => ({
    name: candidate.name,
    slug: candidate.slug,
    score: candidate.score,
  }));
}

export function extractKnownEntities(text: string): TopicResult[] {
  return extractKnownEntityCandidates(normalizeChunkText(text), 0).map(toTopicResult);
}

export function extractCandidateDecisions(
  artifact: ChunkTextArtifact,
  chunkId: number,
  maxTopics: number = 5,
  phraseLexicon: PhraseLexiconEntry[] = [],
  extractorMode: TopicExtractorMode = "naive"
): CandidateDecision[] {
  const rawCandidates = extractTopicCandidates(artifact, chunkId, maxTopics, phraseLexicon, extractorMode);

  const initialDecisions: CandidateDecision[] = rawCandidates.map((candidate) => {
    const rejectionReason = rejectTopicCandidate(candidate);
    return {
      ...candidate,
      decision: rejectionReason ? "rejected" : "accepted",
      decisionReason: rejectionReason || "candidate_survived_filters",
    };
  });

  const acceptedCandidates = initialDecisions
    .filter((candidate) => candidate.decision === "accepted")
    .sort((a, b) => rankCandidate(b) - rankCandidate(a));

  const acceptedSlugs = new Set<string>();
  let acceptedNonEntities = 0;

  for (const candidate of acceptedCandidates) {
    if (acceptedSlugs.has(candidate.slug)) {
      candidate.decision = "rejected";
      candidate.decisionReason = "duplicate_slug";
      continue;
    }

    if (candidate.kind !== "entity" && acceptedNonEntities >= maxTopics) {
      candidate.decision = "rejected";
      candidate.decisionReason = "max_topics_reached";
      continue;
    }

    acceptedSlugs.add(candidate.slug);
    if (candidate.kind !== "entity") acceptedNonEntities++;
  }

  return initialDecisions;
}

/**
 * Extract topics using the shared normalization and candidate pipeline.
 * corpusStats is kept for API compatibility during the YAKE migration.
 */
export function extractTopics(
  text: string,
  maxTopics: number = 5,
  corpusStats?: CorpusStats,
  extractorMode: TopicExtractorMode = "naive"
): TopicResult[] {
  void corpusStats;
  const decisions = extractCandidateDecisions(normalizeChunkText(text), 0, maxTopics, [], extractorMode);
  return decisions
    .filter((candidate) => candidate.decision === "accepted")
    .map(toTopicResult);
}

function extractBigrams(text: string): Map<string, number> {
  const words = normalizeChunkText(text).normalizedText
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));

  const bigrams = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }

  for (const [bigram, count] of bigrams) {
    if (count < 2) bigrams.delete(bigram);
  }

  return bigrams;
}

void extractBigrams;
