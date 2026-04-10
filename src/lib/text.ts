export const STOPWORDS = new Set([
  // Articles, prepositions, conjunctions
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  // Pronouns
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "who", "whom",
  // Common verbs and adverbs
  "get", "got", "go", "going", "come", "make", "take", "give", "keep",
  "know", "think", "see", "want", "look", "say", "said", "tell", "use",
  "find", "put", "try", "ask", "work", "seem", "feel", "leave", "call",
  "just", "also", "very", "really", "well", "still", "even", "back",
  "right", "only", "much", "now", "here", "then", "already", "actually",
  // Demonstratives, quantifiers
  "this", "that", "these", "those", "not", "no", "nor", "so", "if",
  "than", "too", "about", "above", "after", "again", "all", "any",
  "because", "before", "between", "both", "each", "few", "more", "most",
  "some", "such", "same", "other", "own", "many", "every", "into",
  "through", "over", "out", "up", "off", "down", "away",
  // Common generic words that aren't useful as tags
  "thing", "things", "something", "everything", "nothing", "anything",
  "way", "ways", "lot", "lots", "point", "kind", "sort", "part",
  "time", "times", "people", "person", "everyone", "someone", "world",
  "good", "great", "better", "best", "bad", "worse", "worst",
  "big", "small", "long", "short", "high", "low", "new", "old",
  "first", "last", "next", "different", "important", "able",
  "don", "doesn", "didn", "won", "wouldn", "couldn", "shouldn",
  "isn", "wasn", "aren", "weren", "hasn", "haven", "hadn",
  "it's", "that's", "what's", "there's", "here's", "let's",
  "one", "two", "three", "four", "five",
  "really", "probably", "maybe", "often", "always", "never",
  "hard", "easy", "true", "false", "real", "sure", "likely",
  "basically", "essentially", "simply", "certainly",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

export function stripToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}
