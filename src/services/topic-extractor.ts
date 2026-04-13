import { tokenize, STOPWORDS } from "../lib/text";
import { slugify } from "../lib/slug";
import { decodeHtmlEntities } from "../lib/html";
import { isNoiseTopic } from "./topic-quality";
import { KNOWN_ENTITIES } from "../data/known-entities";

// Words where trailing 's' is part of the word, not a plural
const NO_STRIP = new Set([
  "llms", "process", "analysis", "basis", "crisis", "thesis",
  "diagnosis", "emphasis", "hypothesis", "synopsis", "atlas",
  "bus", "plus", "thus", "status", "focus", "bonus", "campus",
  "virus", "versus", "chaos", "canvas", "bias",
]);

/**
 * Normalize a term: lowercase + strip simple plurals.
 * "systems" → "system", "Grubby Truffles" → "grubby truffle"
 */
export function normalizeTerm(term: string): string {
  const lower = term.toLowerCase().trim();

  // Multi-word: normalize each word
  if (lower.includes(" ")) {
    return lower.split(/\s+/).map((w) => normalizeSingleWord(w)).join(" ");
  }

  return normalizeSingleWord(lower);
}

function normalizeSingleWord(word: string): string {
  if (word.length <= 4) return word;
  if (NO_STRIP.has(word)) return word;

  // -ies → -y (e.g., "strategies" → "strategy")
  if (word.endsWith("ies") && word.length > 5) {
    return word.slice(0, -3) + "y";
  }
  // -ses, -xes, -zes, -ches, -shes → strip -es
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes") ||
      word.endsWith("ches") || word.endsWith("shes")) {
    return word.slice(0, -2);
  }
  // -s (but not -ss, -us, -is)
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }

  return word;
}

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

/**
 * Pre-compute document frequency across the entire corpus.
 * Call once with all chunk plain texts; pass the result to extractTopics.
 */
export function computeCorpusStats(allChunkTexts: string[]): CorpusStats {
  const docFreq = new Map<string, number>();
  for (const text of allChunkTexts) {
    const uniqueWords = new Set(tokenize(decodeHtmlEntities(text)));
    for (const word of uniqueWords) {
      docFreq.set(word, (docFreq.get(word) || 0) + 1);
    }
  }
  return { totalChunks: allChunkTexts.length, docFreq };
}

/**
 * Extract named entities from text using capitalization heuristics.
 * Detects multi-word names (Jeremie Miller), products (Claude Code),
 * and organizations (OpenAI) by finding sequences of capitalized words
 * that don't start a sentence.
 */
// Common words that appear capitalized but aren't entities
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

export function extractEntities(text: string): TopicResult[] {
  const entities: TopicResult[] = [];
  const seen = new Set<string>();

  // Split into sentences
  const sentences = text.split(/[.!?]\s+/);

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    if (words.length < 2) continue;

    // Start from 0 — we'll use context to distinguish sentence-start caps from entities
    let i = 0;
    while (i < words.length) {
      const word = words[i].replace(/[^a-zA-Z'-]/g, "");
      if (word.length >= 2 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
        // Found a capitalized word mid-sentence — collect the full entity
        const entityWords = [word];
        let j = i + 1;
        while (j < words.length) {
          const next = words[j].replace(/[^a-zA-Z'-]/g, "");
          if (next.length >= 2 && next[0] === next[0].toUpperCase() && next[0] !== next[0].toLowerCase()) {
            entityWords.push(next);
            j++;
          } else {
            break;
          }
        }

        const entityName = entityWords.join(" ");
        const normalized = entityName.toLowerCase();

        // At sentence start (i was 0), only keep multi-word entities
        // Single caps words at sentence start are just normal capitalization
        const atSentenceStart = (i - entityWords.length) <= 0;

        // Skip if first word is a common skip word (e.g., "But LLMs", "Once you")
        const firstWordLower = entityWords[0].toLowerCase();
        if (ENTITY_SKIP.has(firstWordLower) || STOPWORDS.has(firstWordLower)) {
          i = j;
          continue;
        }

        if (entityWords.length >= 2 && entityWords.length <= 3 && !seen.has(normalized)) {
          seen.add(normalized);
          const norm = normalizeTerm(entityName);
          entities.push({
            name: norm,
            slug: slugify(norm),
            kind: "entity",
          });
        } else if (entityWords.length === 1 && !atSentenceStart && !STOPWORDS.has(normalized) && !ENTITY_SKIP.has(normalized) && normalized.length > 3 && !seen.has(normalized)) {
          // Single capitalized word MID-SENTENCE — likely a product/company name
          // Skip sentence-start words (just normal capitalisation, not entities)
          seen.add(normalized);
          const norm = normalizeTerm(entityName);
          entities.push({
            name: norm,
            slug: slugify(norm),
            kind: "entity",
          });
        }

        i = j;
      } else {
        i++;
      }
    }
  }

  return entities;
}

/**
 * Layer 1: Extract known entities from text by matching against the curated entity list.
 * Case-insensitive matching against all aliases. Bypasses TF-IDF scoring entirely.
 * Returns TopicResult with canonical name and slug for each matched entity.
 */
export function extractKnownEntities(text: string): TopicResult[] {
  const lowerText = text.toLowerCase();
  const results: TopicResult[] = [];
  const seenNames = new Set<string>();

  for (const entity of KNOWN_ENTITIES) {
    if (seenNames.has(entity.name)) continue;

    const aliases = entity.aliases || [];
    // Check canonical name (lowercased) and all aliases against the text
    const allForms = [entity.name.toLowerCase(), ...aliases];

    let matched = false;
    for (const form of allForms) {
      if (lowerText.includes(form)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      seenNames.add(entity.name);
      results.push({
        name: entity.name,
        slug: slugify(entity.name),
        score: 200, // known entities get highest priority
        kind: "entity",
      });
    }
  }

  return results;
}

/**
 * Layer 3: Identify high-distinctiveness non-baseline words as entity candidates.
 * These are words that appear in the corpus but not in the English baseline,
 * with distinctiveness >= 15 and length >= 4.
 */
export function identifyDistinctiveEntities(
  wordStats: { word: string; distinctiveness: number; in_baseline: number }[]
): string[] {
  return wordStats
    .filter(w => w.distinctiveness >= 15 && w.in_baseline === 0 && w.word.length >= 4)
    .map(w => w.word);
}

/**
 * Extract topics using TF-IDF scoring with entity detection.
 * Merges three sources: known entities (Layer 1), capitalization heuristics, and TF-IDF keywords.
 *
 * @param text - chunk content
 * @param maxTopics - maximum topics to return (default 15)
 * @param corpusStats - pre-computed IDF stats (optional, falls back to pure TF)
 */
export function extractTopics(
  text: string,
  maxTopics: number = 15,
  corpusStats?: CorpusStats
): TopicResult[] {
  const clean = decodeHtmlEntities(text);

  // Layer 1: Known entities (highest priority, bypass TF-IDF)
  const knownEntities = extractKnownEntities(clean);

  // Step 1: Extract named entities via capitalization heuristics
  const heuristicEntities = extractEntities(clean);
  const entityNames = new Set(
    heuristicEntities.flatMap((e) => e.name.toLowerCase().split(" "))
  );

  // Step 2: Tokenize and compute term frequency
  const words = tokenize(clean);
  const termFreq = new Map<string, number>();
  for (const word of words) {
    // Skip words that are parts of detected entities
    if (entityNames.has(word)) continue;
    termFreq.set(word, (termFreq.get(word) || 0) + 1);
  }

  // Note: per-chunk bigrams removed — corpus-level n-gram extraction (in finalizeEnrichment)
  // discovers phrase topics more reliably across documents.

  // Step 3: Score with TF-IDF
  const N = corpusStats?.totalChunks || 1;
  const scored = [...termFreq.entries()]
    .filter(([word]) => {
      const normalized = normalizeTerm(word);
      if (normalized.length < 4) return false;
      const slug = slugify(normalized);
      if (!slug || slug.length < 3) return false;
      if (STOPWORDS.has(word)) return false;
      return true;
    })
    .map(([word, tf]) => {
      let idf = 1;
      if (corpusStats) {
        const df = corpusStats.docFreq.get(word) || 1;
        idf = Math.log(N / df);
      }
      const normalized = normalizeTerm(word);
      return { name: normalized, slug: slugify(normalized), score: tf * idf };
    })
    .sort((a, b) => b.score - a.score);

  // Step 5: Merge known entities + heuristic entities + TF-IDF keywords
  // Known entities always win (highest priority)
  const result: TopicResult[] = [];
  const usedSlugs = new Set<string>();

  // Layer 1: Known entities first
  for (const entity of knownEntities) {
    if (result.length >= maxTopics) break;
    if (usedSlugs.has(entity.slug)) continue;
    usedSlugs.add(entity.slug);
    result.push(entity);
  }

  // Heuristic entities next
  for (const entity of heuristicEntities) {
    if (result.length >= maxTopics) break;
    if (usedSlugs.has(entity.slug)) continue;
    usedSlugs.add(entity.slug);
    result.push({ ...entity, score: 100 }); // heuristic entities get high score
  }

  // TF-IDF keywords last — filter noise here (not in the caller)
  for (const topic of scored) {
    if (result.length >= maxTopics) break;
    if (usedSlugs.has(topic.slug)) continue;
    if (isNoiseTopic(topic.name)) continue;
    usedSlugs.add(topic.slug);
    result.push(topic);
  }

  return result;
}

function extractBigrams(text: string): Map<string, number> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

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
