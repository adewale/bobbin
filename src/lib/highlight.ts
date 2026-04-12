import { escapeRegex } from "./html";

/**
 * Extract left and right context around the first occurrence of `keyword` in `text`.
 * Used for KWIC (Key Word In Context) display.
 */
export function extractKWIC(text: string, keyword: string, contextChars = 40): { left: string; right: string } | null {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx === -1) return null;

  const leftStart = Math.max(0, idx - contextChars);
  const rightEnd = Math.min(text.length, idx + keyword.length + contextChars);

  let left = text.substring(leftStart, idx);
  let right = text.substring(idx + keyword.length, rightEnd);

  if (leftStart > 0) left = "\u2026" + left;
  if (rightEnd < text.length) right = right + "\u2026";

  return { left, right };
}

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
