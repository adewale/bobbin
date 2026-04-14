/**
 * YAKE! keyword extraction — pure JS implementation.
 *
 * Based on: Campos et al., "YAKE! Keyword extraction from single documents
 * using multiple local features", Information Sciences, 2020.
 *
 * Scores candidates using within-document features:
 * - Term casing (uppercase ratio signals proper nouns / acronyms)
 * - Term position (terms appearing earlier are more important)
 * - Term frequency (normalized by document length)
 * - Term relatedness (how many different context words appear nearby)
 * - Sentence count (terms in more sentences are more important)
 *
 * Lower score = more important keyword.
 */

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an",
  "and", "any", "are", "aren't", "as", "at", "be", "because", "been",
  "before", "being", "below", "between", "both", "but", "by", "can",
  "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
  "doesn't", "doing", "don't", "down", "during", "each", "few", "for",
  "from", "further", "get", "got", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "hers", "herself", "him", "himself", "his", "how", "i", "i'd",
  "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "just", "let's", "me", "might", "more",
  "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
  "on", "once", "only", "or", "other", "ought", "our", "ours",
  "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd",
  "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them",
  "themselves", "then", "there", "there's", "these", "they", "they'd",
  "they'll", "they're", "they've", "this", "those", "through", "to",
  "too", "under", "until", "up", "us", "very", "was", "wasn't", "we",
  "we'd", "we'll", "we're", "we've", "were", "weren't", "what",
  "what's", "when", "when's", "where", "where's", "which", "while",
  "who", "who's", "whom", "why", "why's", "will", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've",
  "your", "yours", "yourself", "yourselves", "also", "still", "even",
  "many", "much", "well", "however", "already", "often", "really",
  "quite", "rather",
]);

interface YakeResult {
  keyword: string;
  score: number;
}

interface WordFeatures {
  tf: number;           // term frequency (count)
  casing: number;       // ratio of uppercase starts
  position: number;     // median position (0-1, lower = earlier)
  relatedness: number;  // number of distinct context words
  sentences: number;    // number of sentences containing the word
}

/**
 * Extract keywords from text using YAKE algorithm.
 * @param text - input text
 * @param n - max number of keywords to return (default 5)
 * @param maxNgram - max n-gram size (default 3)
 * @returns keywords sorted by score (ascending = more important)
 */
export function extractYakeKeywords(
  text: string,
  n: number = 5,
  maxNgram: number = 3
): YakeResult[] {
  if (!text || text.trim().length === 0) return [];

  // Split into sentences
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return [];

  // Tokenize preserving case for casing feature
  const allWords: { word: string; original: string; sentIdx: number; posIdx: number }[] = [];
  let globalPos = 0;
  for (let si = 0; si < sentences.length; si++) {
    const words = sentences[si].trim().split(/\s+/).filter(w => w.length > 0);
    for (const w of words) {
      const clean = w.replace(/[^a-zA-Z0-9'-]/g, "");
      if (clean.length > 0) {
        allWords.push({ word: clean.toLowerCase(), original: clean, sentIdx: si, posIdx: globalPos });
        globalPos++;
      }
    }
  }

  if (allWords.length === 0) return [];

  // Compute per-word features
  const wordFeatures = new Map<string, WordFeatures>();
  const contextLeft = new Map<string, Set<string>>();
  const contextRight = new Map<string, Set<string>>();

  for (let i = 0; i < allWords.length; i++) {
    const w = allWords[i].word;
    if (STOPWORDS.has(w) || w.length < 2) continue;

    const feat = wordFeatures.get(w) || {
      tf: 0, casing: 0, position: 0, relatedness: 0, sentences: 0,
    };
    feat.tf++;

    // Casing: count how often this word starts uppercase
    if (allWords[i].original[0] === allWords[i].original[0].toUpperCase() &&
        allWords[i].original[0] !== allWords[i].original[0].toLowerCase()) {
      feat.casing++;
    }

    wordFeatures.set(w, feat);

    // Context words (left and right neighbors)
    if (!contextLeft.has(w)) contextLeft.set(w, new Set());
    if (!contextRight.has(w)) contextRight.set(w, new Set());
    if (i > 0 && !STOPWORDS.has(allWords[i - 1].word)) {
      contextLeft.get(w)!.add(allWords[i - 1].word);
    }
    if (i < allWords.length - 1 && !STOPWORDS.has(allWords[i + 1].word)) {
      contextRight.get(w)!.add(allWords[i + 1].word);
    }
  }

  // Compute position and sentence features
  const totalWords = allWords.length;
  for (const [w, feat] of wordFeatures) {
    // Median position (normalized 0-1)
    const positions = allWords
      .filter(a => a.word === w)
      .map(a => a.posIdx / totalWords);
    positions.sort((a, b) => a - b);
    feat.position = positions[Math.floor(positions.length / 2)];

    // Sentence spread
    const sentSet = new Set(allWords.filter(a => a.word === w).map(a => a.sentIdx));
    feat.sentences = sentSet.size;

    // Casing ratio
    feat.casing = feat.casing / feat.tf;

    // Relatedness: distinct context words / frequency
    const leftCtx = contextLeft.get(w)?.size || 0;
    const rightCtx = contextRight.get(w)?.size || 0;
    feat.relatedness = (leftCtx + rightCtx) / (feat.tf || 1);
  }

  // Score individual words
  const wordScores = new Map<string, number>();
  const meanTf = [...wordFeatures.values()].reduce((s, f) => s + f.tf, 0) / wordFeatures.size;
  const stdTf = Math.sqrt(
    [...wordFeatures.values()].reduce((s, f) => s + (f.tf - meanTf) ** 2, 0) / wordFeatures.size
  );

  for (const [w, feat] of wordFeatures) {
    // YAKE score components (lower = better)
    const tCase = Math.max(feat.casing, 1 - feat.casing); // penalize mixed case
    const tPos = Math.log(2 + feat.position); // earlier = better (lower)
    const tFreq = feat.tf / (meanTf + stdTf + 1); // normalized frequency
    const tRel = 1 + feat.relatedness; // more context variety = less important
    const tSent = feat.sentences / sentences.length; // sentence coverage

    // Combined score: lower = more important
    const score = (tPos * tRel) / (tCase + (tFreq / tRel) + 0.5 * tSent + 1);
    wordScores.set(w, score);
  }

  // Generate n-gram candidates
  const candidates = new Map<string, number>();

  for (let si = 0; si < sentences.length; si++) {
    const sentWords = allWords.filter(a => a.sentIdx === si);

    for (let size = 1; size <= maxNgram; size++) {
      for (let i = 0; i <= sentWords.length - size; i++) {
        const gram = sentWords.slice(i, i + size);
        const words = gram.map(g => g.word);

        // Skip if starts or ends with stopword
        if (STOPWORDS.has(words[0]) || STOPWORDS.has(words[words.length - 1])) continue;
        // Skip if all stopwords
        if (words.every(w => STOPWORDS.has(w))) continue;
        // Skip very short single words
        if (size === 1 && words[0].length < 3) continue;

        const phrase = words.join(" ");

        // Score n-gram: product of component word scores (lower = better)
        let score = 1;
        let allScored = true;
        for (const w of words) {
          const ws = wordScores.get(w);
          if (ws !== undefined) {
            score *= ws;
          } else {
            allScored = false;
          }
        }
        if (!allScored) continue;

        // Normalize by n-gram length (longer phrases get slight bonus)
        score = score / (size * 0.5 + 0.5);

        // Keep best score for this phrase
        if (!candidates.has(phrase) || candidates.get(phrase)! > score) {
          candidates.set(phrase, score);
        }
      }
    }
  }

  // Sort by score (ascending = most important first)
  const sorted = [...candidates.entries()]
    .sort((a, b) => a[1] - b[1]);

  // Deduplicate: remove phrases that are substrings of higher-ranked phrases
  const results: YakeResult[] = [];
  const seen = new Set<string>();

  for (const [phrase, score] of sorted) {
    if (results.length >= n) break;

    // Skip if this phrase is contained in an already-selected phrase
    let isSubstring = false;
    for (const selected of seen) {
      if (selected.includes(phrase) || phrase.includes(selected)) {
        isSubstring = true;
        break;
      }
    }
    if (isSubstring) continue;

    seen.add(phrase);
    results.push({ keyword: phrase, score });
  }

  return results;
}
