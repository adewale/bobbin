export const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "dare", "ought", "used", "this", "that", "these", "those", "it", "its",
  "not", "no", "nor", "so", "if", "then", "than", "too", "very", "just",
  "about", "above", "after", "again", "all", "also", "am", "any",
  "because", "before", "between", "both", "each", "few", "get", "got",
  "here", "how", "into", "like", "more", "most", "much", "must",
  "my", "new", "now", "only", "other", "our", "out", "over", "own",
  "same", "she", "some", "still", "such", "take", "tell", "their",
  "them", "there", "they", "thing", "things", "think", "through",
  "up", "us", "way", "we", "what", "when", "where", "which", "while",
  "who", "whom", "why", "you", "your", "he", "her", "him", "his",
  "i", "me", "one", "two", "even", "well", "back", "make", "many",
  "going", "know", "come", "really", "see", "want", "look", "right",
  "say", "said", "go", "something", "lot", "don", "doesn",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
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
