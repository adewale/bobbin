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
  // Decode HTML entities before processing
  const clean = text
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  const words = tokenize(clean);
  const termFreq = new Map<string, number>();

  for (const word of words) {
    termFreq.set(word, (termFreq.get(word) || 0) + 1);
  }

  // Extract meaningful bigrams (must appear 2+ times)
  const bigrams = extractBigrams(clean);
  for (const [bigram, count] of bigrams) {
    termFreq.set(bigram, count * 2);
  }

  // Filter and score
  const scored = [...termFreq.entries()]
    .filter(([word]) => {
      if (word.length < 4) return false;
      const slug = slugify(word);
      if (!slug || slug.length < 3) return false;
      // Skip words that are just common English
      if (STOPWORDS.has(word)) return false;
      return true;
    })
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
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

  const bigrams = new Map<string, number>();

  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }

  // Only keep bigrams appearing 2+ times
  for (const [bigram, count] of bigrams) {
    if (count < 2) bigrams.delete(bigram);
  }

  return bigrams;
}
