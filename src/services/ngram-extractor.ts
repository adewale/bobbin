import { STOPWORDS } from "../lib/text";

/** Additional words that produce garbage n-gram phrases */
const NGRAM_STOP = new Set([
  ...STOPWORDS,
  "how", "what", "that", "this", "just", "very", "also", "still", "already",
  "allow", "make", "take", "give", "come", "going", "want", "need", "think",
  "know", "look", "find", "seem", "feel", "tell", "show", "keep", "help",
  "really", "thing", "things", "something", "everything", "nothing",
  "matter", "figure", "point", "kind", "sort",
]);

function isStopWord(w: string): boolean {
  return NGRAM_STOP.has(w);
}

/**
 * Extract significant bigrams and trigrams from a corpus of texts.
 * Returns phrases that appear in multiple documents with frequency above threshold.
 * All words in a phrase are checked against stopwords (not just first/last).
 */
export function extractCorpusNgrams(
  texts: string[],
  minCount: number = 5,
  minDocs: number = 3
): { phrase: string; count: number; docCount: number }[] {
  const phraseCounts = new Map<string, number>();
  const phraseDocs = new Map<string, Set<number>>();

  for (let docIdx = 0; docIdx < texts.length; docIdx++) {
    const words = texts[docIdx]
      .toLowerCase()
      .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // normalize curly quotes
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 3 && !isStopWord(w));

    const seenInDoc = new Set<string>();

    // Bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (seenInDoc.has(bigram)) continue;
      seenInDoc.add(bigram);
      phraseCounts.set(bigram, (phraseCounts.get(bigram) || 0) + 1);
      if (!phraseDocs.has(bigram)) phraseDocs.set(bigram, new Set());
      phraseDocs.get(bigram)!.add(docIdx);
    }

    // Trigrams (only if all 3 words passed the filter above)
    for (let i = 0; i < words.length - 2; i++) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (seenInDoc.has(trigram)) continue;
      seenInDoc.add(trigram);
      phraseCounts.set(trigram, (phraseCounts.get(trigram) || 0) + 1);
      if (!phraseDocs.has(trigram)) phraseDocs.set(trigram, new Set());
      phraseDocs.get(trigram)!.add(docIdx);
    }
  }

  return [...phraseCounts.entries()]
    .filter(([phrase, count]) => count >= minCount && (phraseDocs.get(phrase)?.size || 0) >= minDocs)
    .map(([phrase, count]) => ({
      phrase,
      count,
      docCount: phraseDocs.get(phrase)?.size || 0,
    }))
    .sort((a, b) => b.docCount - a.docCount);
}
