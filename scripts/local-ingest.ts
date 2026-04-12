/**
 * Local ingestion script: parses downloaded HTML files and shows what would be ingested.
 * Run with: npx tsx scripts/local-ingest.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { parseHtmlDocument } from "../src/services/html-parser";
import { extractTopics } from "../src/services/topic-extractor";

const dataDir = "./data/raw";
const files = readdirSync(dataDir).filter((f) => f.endsWith(".html"));

let totalEpisodes = 0;
let totalChunks = 0;
const allTopics = new Map<string, number>();

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
        const topics = extractTopics(chunk.contentPlain);
        console.log(`    [${chunk.position}] ${chunk.title.substring(0, 70)}`);
        console.log(`        Topics: ${topics.map((t) => t.name).join(", ")}`);
        for (const t of topics) {
          allTopics.set(t.name, (allTopics.get(t.name) || 0) + 1);
        }
      }
      if (ep.chunks.length > 3) {
        // Still count topics for remaining chunks
        for (const chunk of ep.chunks.slice(3)) {
          for (const t of extractTopics(chunk.contentPlain)) {
            allTopics.set(t.name, (allTopics.get(t.name) || 0) + 1);
          }
        }
        console.log(`    ...and ${ep.chunks.length - 3} more chunks`);
      }
    } else {
      for (const chunk of ep.chunks) {
        for (const t of extractTopics(chunk.contentPlain)) {
          allTopics.set(t.name, (allTopics.get(t.name) || 0) + 1);
        }
      }
    }
  }
}

console.log(`\n=== TOTALS ===`);
console.log(`Episodes: ${totalEpisodes}`);
console.log(`Chunks: ${totalChunks}`);
console.log(`Unique topics: ${allTopics.size}`);
console.log(`\nTop 30 topics:`);
const sorted = [...allTopics.entries()].sort((a, b) => b[1] - a[1]);
for (const [topic, count] of sorted.slice(0, 30)) {
  console.log(`  ${count.toString().padStart(4)}  ${topic}`);
}
