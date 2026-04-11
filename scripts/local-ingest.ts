/**
 * Local ingestion script: parses downloaded HTML files and shows what would be ingested.
 * Run with: npx tsx scripts/local-ingest.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { parseHtmlDocument } from "../src/services/html-parser";
import { extractTags } from "../src/services/tag-generator";

const dataDir = "./data/raw";
const files = readdirSync(dataDir).filter((f) => f.endsWith(".html"));

let totalEpisodes = 0;
let totalChunks = 0;
const allTags = new Map<string, number>();

for (const file of files) {
  const html = readFileSync(`${dataDir}/${file}`, "utf-8");
  const episodes = parseHtmlDocument(html);

  console.log(`\n=== ${file} (${(html.length / 1024).toFixed(0)} KB) ===`);
  console.log(`Episodes: ${episodes.length}`);

  for (const ep of episodes) {
    totalEpisodes++;
    totalChunks += ep.chunks.length;

    if (totalEpisodes <= 3) {
      console.log(`\n  ${ep.title} (${ep.chunks.length} chunks)`);
      for (const chunk of ep.chunks.slice(0, 3)) {
        const tags = extractTags(chunk.contentPlain);
        console.log(`    [${chunk.position}] ${chunk.title.substring(0, 70)}`);
        console.log(`        Tags: ${tags.map((t) => t.name).join(", ")}`);
        for (const t of tags) {
          allTags.set(t.name, (allTags.get(t.name) || 0) + 1);
        }
      }
      if (ep.chunks.length > 3) {
        // Still count tags for remaining chunks
        for (const chunk of ep.chunks.slice(3)) {
          for (const t of extractTags(chunk.contentPlain)) {
            allTags.set(t.name, (allTags.get(t.name) || 0) + 1);
          }
        }
        console.log(`    ...and ${ep.chunks.length - 3} more chunks`);
      }
    } else {
      for (const chunk of ep.chunks) {
        for (const t of extractTags(chunk.contentPlain)) {
          allTags.set(t.name, (allTags.get(t.name) || 0) + 1);
        }
      }
    }
  }
}

console.log(`\n=== TOTALS ===`);
console.log(`Episodes: ${totalEpisodes}`);
console.log(`Chunks: ${totalChunks}`);
console.log(`Unique tags: ${allTags.size}`);
console.log(`\nTop 30 tags:`);
const sorted = [...allTags.entries()].sort((a, b) => b[1] - a[1]);
for (const [tag, count] of sorted.slice(0, 30)) {
  console.log(`  ${count.toString().padStart(4)}  ${tag}`);
}
