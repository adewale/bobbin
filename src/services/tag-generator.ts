import { tokenize, STOPWORDS } from "../lib/text";
import { slugify } from "../lib/slug";
import { decodeHtmlEntities } from "../lib/html";

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

export interface TagResult {
  name: string;
  slug: string;
  score?: number;
}

export interface CorpusStats {
  totalChunks: number;
  docFreq: Map<string, number>;
}

/**
 * Pre-compute document frequency across the entire corpus.
 * Call once with all chunk plain texts; pass the result to extractTags.
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

export function extractEntities(text: string): TagResult[] {
  const entities: TagResult[] = [];
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
          });
        } else if (entityWords.length === 1 && !STOPWORDS.has(normalized) && !ENTITY_SKIP.has(normalized) && normalized.length > 3 && !seen.has(normalized)) {
          // Single capitalized word — likely a product/company name
          // Only include if it doesn't look like a common word
          seen.add(normalized);
          const norm = normalizeTerm(entityName);
          entities.push({
            name: norm,
            slug: slugify(norm),
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
 * Extract tags using TF-IDF scoring with entity detection.
 *
 * @param text - chunk content
 * @param maxTags - maximum tags to return (default 5)
 * @param corpusStats - pre-computed IDF stats (optional, falls back to pure TF)
 */
export function extractTags(
  text: string,
  maxTags: number = 5,
  corpusStats?: CorpusStats
): TagResult[] {
  const clean = decodeHtmlEntities(text);

  // Step 1: Extract named entities
  const entities = extractEntities(text);
  const entityNames = new Set(
    entities.flatMap((e) => e.name.toLowerCase().split(" "))
  );

  // Step 2: Tokenize and compute term frequency
  const words = tokenize(clean);
  const termFreq = new Map<string, number>();
  for (const word of words) {
    // Skip words that are parts of detected entities
    if (entityNames.has(word)) continue;
    termFreq.set(word, (termFreq.get(word) || 0) + 1);
  }

  // Step 3: Extract bigrams (non-entity)
  const bigrams = extractBigrams(clean);
  for (const [bigram, count] of bigrams) {
    // Skip bigrams that overlap with entities
    const parts = bigram.split(" ");
    if (parts.some((p) => entityNames.has(p))) continue;
    termFreq.set(bigram, count * 2);
  }

  // Step 4: Score with TF-IDF
  const N = corpusStats?.totalChunks || 1;
  const scored = [...termFreq.entries()]
    .filter(([word]) => {
      if (word.length < 4) return false;
      const slug = slugify(word);
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

  // Step 5: Merge entities + TF-IDF keywords
  // Entities come first (they're high-signal named things)
  const result: TagResult[] = [];
  const usedSlugs = new Set<string>();

  for (const entity of entities) {
    if (result.length >= maxTags) break;
    if (usedSlugs.has(entity.slug)) continue;
    usedSlugs.add(entity.slug);
    result.push({ ...entity, score: 100 }); // entities get high score
  }

  for (const tag of scored) {
    if (result.length >= maxTags) break;
    if (usedSlugs.has(tag.slug)) continue;
    usedSlugs.add(tag.slug);
    result.push(tag);
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
