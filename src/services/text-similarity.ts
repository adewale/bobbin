/**
 * Text similarity utilities for topic deduplication.
 *
 * Dice coefficient on character bigrams is fast, language-independent,
 * and handles partial matches well (e.g., "chatbot" vs "chatbots").
 */

/**
 * Compute character bigrams for a string.
 */
function bigrams(str: string): Set<string> {
  const s = str.toLowerCase();
  const result = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.substring(i, i + 2));
  }
  return result;
}

/**
 * Dice coefficient: 2 * |intersection| / (|A| + |B|)
 * Returns 0.0 (no similarity) to 1.0 (identical).
 */
export function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0.0;
  if (a === b) return 1.0;

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Simple Porter stemmer (English only, handles common suffixes).
 * Not a full implementation — just enough to collapse inflectional variants
 * like "chatbots"→"chatbot", "computing"→"comput", "models"→"model".
 */
export function simpleStem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;

  // Step 1: Plurals and -ed/-ing
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ies") && w.length > 5) w = w.slice(0, -3) + "y";
  else if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && w.length > 4) w = w.slice(0, -1);

  if (w.endsWith("eed")) { /* keep */ }
  else if (w.endsWith("ed") && w.length > 5) {
    w = w.slice(0, -2);
    if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) w += "e";
  }
  else if (w.endsWith("ing") && w.length > 6) {
    w = w.slice(0, -3);
    if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) w += "e";
  }

  // Step 2: -tion/-ation → -t/-at (light)
  if (w.endsWith("ational")) w = w.slice(0, -5) + "e";
  else if (w.endsWith("ation") && w.length > 7) w = w.slice(0, -3) + "e";

  return w;
}

/**
 * Cluster topics by string similarity using Dice coefficient.
 * Returns groups where each group maps to a canonical representative.
 *
 * @param names - topic names to cluster
 * @param threshold - Dice threshold for merging (default 0.7)
 * @returns Map from each name to its canonical representative
 */
export function clusterBySimilarity(
  names: string[],
  threshold: number = 0.7
): Map<string, string> {
  const canonical = new Map<string, string>();
  const representatives: string[] = [];

  // Sort by length descending — longer names become representatives
  const sorted = [...names].sort((a, b) => b.length - a.length);

  for (const name of sorted) {
    let merged = false;
    for (const rep of representatives) {
      if (diceCoefficient(name, rep) >= threshold) {
        // Merge into existing cluster — keep the longer/more specific name as canonical
        canonical.set(name, rep);
        merged = true;
        break;
      }
    }
    if (!merged) {
      representatives.push(name);
      canonical.set(name, name); // self-representative
    }
  }

  return canonical;
}
