/**
 * Compute distinctiveness scores for concordance words and output SQL.
 * Run with: npx tsx scripts/compute-distinctiveness.ts | pbcopy
 * Then paste into wrangler d1 execute.
 */
import { readFileSync } from "node:fs";
import { computeDistinctiveness, loadEnglishBaseline } from "../src/services/distinctiveness";
import { tokenize } from "../src/lib/text";
import { parseHtmlDocument } from "../src/services/html-parser";

const baseline = loadEnglishBaseline();

// Load all chunk texts from local cache
const allTexts: string[] = [];
for (const file of [
  "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA.html",
  "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw.html",
  "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html",
]) {
  try {
    const html = readFileSync(`data/raw/${file}`, "utf-8");
    const eps = parseHtmlDocument(html);
    for (const ep of eps) {
      for (const c of ep.chunks) {
        allTexts.push(c.contentPlain);
      }
    }
  } catch {
    // File may not exist
  }
}

// Compute word frequencies
const freq = new Map<string, number>();
let totalWords = 0;
for (const text of allTexts) {
  for (const word of tokenize(text)) {
    freq.set(word, (freq.get(word) || 0) + 1);
    totalWords++;
  }
}

const results = computeDistinctiveness(freq, totalWords, baseline);

// Output SQL to update the concordance table
console.log("-- Distinctiveness scores computed from local corpus");
console.log(`-- Corpus: ${allTexts.length} chunks, ${totalWords} tokens, ${freq.size} unique words`);
console.log();

for (const r of results) {
  const inBaseline = r.baselineRank !== null ? 1 : 0;
  const escaped = r.word.replace(/'/g, "''");
  console.log(
    `UPDATE concordance SET distinctiveness = ${r.distinctiveness.toFixed(4)}, in_baseline = ${inBaseline} WHERE word = '${escaped}';`
  );
}

console.error(`Generated ${results.length} UPDATE statements`);
