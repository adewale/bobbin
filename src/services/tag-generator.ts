import { tokenize, STOPWORDS } from "../lib/text";
import { slugify } from "../lib/slug";

interface TagResult {
  name: string;
  slug: string;
}

export function extractTags(
  text: string,
  maxTags: number = 5
): TagResult[] {
  const words = tokenize(text);
  const termFreq = new Map<string, number>();

  for (const word of words) {
    termFreq.set(word, (termFreq.get(word) || 0) + 1);
  }

  // Extract bigrams
  const bigrams = extractBigrams(text);
  for (const [bigram, count] of bigrams) {
    termFreq.set(bigram, count * 2); // Boost bigrams
  }

  // Score and sort by frequency
  const scored = [...termFreq.entries()]
    .filter(([word]) => word.length > 3)
    .sort((a, b) => b[1] - a[1]);

  return scored.slice(0, maxTags).map(([word]) => ({
    name: word,
    slug: slugify(word),
  }));
}

function extractBigrams(text: string): Map<string, number> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const bigrams = new Map<string, number>();

  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }

  // Only keep bigrams that appear more than once
  for (const [bigram, count] of bigrams) {
    if (count < 2) {
      bigrams.delete(bigram);
    }
  }

  return bigrams;
}
