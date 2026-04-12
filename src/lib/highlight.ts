import { escapeRegex } from "./html";

/**
 * Extract a short excerpt around the first occurrence of `word` in `text`,
 * then highlight all occurrences of `word` with <mark> tags.
 */
export function highlightInExcerpt(text: string, word: string): string {
  const excerpt = getExcerptAroundWord(text, word);
  const escaped = excerpt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeWord = escapeRegex(word);
  return escaped.replace(new RegExp(`(${safeWord})`, "gi"), "<mark>$1</mark>");
}

/**
 * Return a substring of `text` centred on the first occurrence of `word`.
 */
export function getExcerptAroundWord(
  text: string,
  word: string,
  maxLen = 300,
): string {
  const lower = text.toLowerCase();
  const wLower = word.toLowerCase();
  const idx = lower.indexOf(wLower);
  if (idx === -1) return text.substring(0, maxLen);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + word.length + 150);
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = "..." + excerpt;
  if (end < text.length) excerpt += "...";
  return excerpt;
}
