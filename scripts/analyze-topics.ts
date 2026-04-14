/**
 * Analyze topic extraction quality on the local corpus.
 * Shows what topics are being extracted and helps tune TF-IDF parameters.
 *
 * Usage: npx tsx scripts/analyze-topics.ts [episodes]
 */
import { readFileSync, readdirSync } from "node:fs";
import { parseHtmlDocument } from "../src/services/html-parser";
import { extractTopics, extractEntities, extractKnownEntities, computeCorpusStats } from "../src/services/topic-extractor";
import { isNoiseTopic } from "../src/services/topic-quality";
import { tokenize, STOPWORDS } from "../src/lib/text";
import { decodeHtmlEntities } from "../src/lib/html";

const maxEpisodes = parseInt(process.argv[2] || "20", 10);

// Parse all HTML
const dataDir = "./data/raw";
const files = readdirSync(dataDir).filter(f => f.endsWith(".html"));
let allEpisodes: any[] = [];
for (const file of files) {
  const html = readFileSync(`${dataDir}/${file}`, "utf-8");
  allEpisodes.push(...parseHtmlDocument(html));
}
const episodes = allEpisodes.slice(0, maxEpisodes);
const chunks = episodes.flatMap(ep => ep.chunks);
console.log(`Corpus: ${episodes.length} episodes, ${chunks.length} chunks\n`);

// Build corpus stats (IDF)
const texts = chunks.map(c => c.contentPlain);
const corpusStats = computeCorpusStats(texts);

// Extract topics for each chunk
const topicCounts = new Map<string, { count: number; kind: string; sources: Set<string> }>();
const perChunkTopicCounts: number[] = [];
const allExtracted: { chunk: string; topics: any[] }[] = [];

for (const chunk of chunks) {
  const topics = extractTopics(chunk.contentPlain, 10, corpusStats);
  perChunkTopicCounts.push(topics.length);

  allExtracted.push({
    chunk: chunk.title.substring(0, 60),
    topics: topics.map(t => ({ name: t.name, kind: t.kind || "concept", score: t.score })),
  });

  for (const t of topics) {
    const key = t.name.toLowerCase();
    const existing = topicCounts.get(key) || { count: 0, kind: t.kind || "concept", sources: new Set() };
    existing.count++;
    existing.sources.add(chunk.title.substring(0, 40));
    topicCounts.set(key, existing);
  }
}

// Analyze topic distribution
const sorted = [...topicCounts.entries()].sort((a, b) => b[1].count - a[1].count);
const totalUnique = sorted.length;
const singletons = sorted.filter(([, v]) => v.count === 1).length;
const usageGte2 = sorted.filter(([, v]) => v.count >= 2).length;
const usageGte5 = sorted.filter(([, v]) => v.count >= 5).length;

console.log("=== TOPIC DISTRIBUTION ===");
console.log(`Total unique topics: ${totalUnique}`);
console.log(`Singletons (count=1): ${singletons} (${(singletons/totalUnique*100).toFixed(0)}%)`);
console.log(`Usage >= 2: ${usageGte2}`);
console.log(`Usage >= 5: ${usageGte5}`);
console.log(`Topics per chunk: min=${Math.min(...perChunkTopicCounts)} max=${Math.max(...perChunkTopicCounts)} avg=${(perChunkTopicCounts.reduce((s,n)=>s+n,0)/perChunkTopicCounts.length).toFixed(1)}`);

console.log("\n=== TOP 50 TOPICS ===");
for (const [name, data] of sorted.slice(0, 50)) {
  const kindTag = data.kind !== "concept" ? ` [${data.kind}]` : "";
  const noiseTag = isNoiseTopic(name) ? " [NOISE]" : "";
  console.log(`  ${data.count.toString().padStart(4)}  ${name}${kindTag}${noiseTag}`);
}

// Identify likely bad topics (single words, common English)
console.log("\n=== LIKELY GARBAGE (single words, usage >= 3) ===");
const COMMON_ENGLISH = new Set([
  // Verbs/adjectives that TF-IDF picks up but aren't navigational
  "emergent", "resonant", "insight", "moment", "outcome", "personal",
  "consumer", "incumbent", "abstract", "concrete", "shallow", "narrow",
  "broad", "curious", "obvious", "weird", "strange", "familiar",
  "elegant", "subtle", "bold", "fragile", "robust", "mature",
  "novel", "ancient", "modern", "classic", "native", "organic",
  "friction", "tension", "inertia", "momentum", "gravity", "entropy",
  "artifact", "surface", "boundary", "horizon", "landscape", "terrain",
  "spectrum", "dimension", "threshold", "trajectory", "catalyst",
  "symptom", "diagnosis", "remedy", "prescription",
  "ecosystem", "organism", "species", "niche", "habitat",
  "ingredient", "recipe", "flavor", "taste",
  "shelf", "drawer", "closet", "cabinet",
  // Past tenses / gerunds that aren't concepts
  "found", "built", "shipped", "launched", "released", "acquired",
  "emerged", "evolved", "adapted", "absorbed", "collapsed", "expanded",
  "declined", "improved", "transformed", "replaced", "disrupted",
]);

for (const [name, data] of sorted) {
  if (data.count >= 3 && !name.includes(" ") && data.kind === "concept") {
    const isGarbage = COMMON_ENGLISH.has(name) || isNoiseTopic(name);
    if (isGarbage) {
      console.log(`  ${data.count.toString().padStart(4)}  ${name}`);
    }
  }
}

// IDF analysis — what IDF threshold separates good from bad?
console.log("\n=== IDF ANALYSIS ===");
const idfValues: { word: string; idf: number; count: number }[] = [];
for (const [name, data] of sorted) {
  if (!name.includes(" ") && data.kind === "concept") {
    const df = corpusStats.docFreq.get(name) || 1;
    const idf = Math.log(corpusStats.totalChunks / df);
    idfValues.push({ word: name, idf, count: data.count });
  }
}
idfValues.sort((a, b) => a.idf - b.idf);

console.log("Lowest IDF (most common words — likely noise):");
for (const v of idfValues.slice(0, 20)) {
  const noiseTag = isNoiseTopic(v.word) || COMMON_ENGLISH.has(v.word) ? " [BAD]" : "";
  console.log(`  IDF=${v.idf.toFixed(2)} count=${v.count.toString().padStart(3)}  ${v.word}${noiseTag}`);
}

console.log("\nHighest IDF (most distinctive — likely good):");
for (const v of idfValues.slice(-20)) {
  console.log(`  IDF=${v.idf.toFixed(2)} count=${v.count.toString().padStart(3)}  ${v.word}`);
}

// Word length analysis
console.log("\n=== WORD LENGTH vs QUALITY ===");
const byLength = new Map<number, { good: number; bad: number }>();
for (const [name, data] of sorted) {
  if (name.includes(" ") || data.kind !== "concept") continue;
  const len = name.length;
  const bucket = byLength.get(len) || { good: 0, bad: 0 };
  if (COMMON_ENGLISH.has(name) || isNoiseTopic(name)) {
    bucket.bad++;
  } else {
    bucket.good++;
  }
  byLength.set(len, bucket);
}
for (const [len, counts] of [...byLength.entries()].sort((a, b) => a[0] - b[0])) {
  const total = counts.good + counts.bad;
  const badPct = total > 0 ? (counts.bad / total * 100).toFixed(0) : "0";
  console.log(`  len=${len}: ${total} topics (${badPct}% bad)`);
}

// Heuristic entity analysis
console.log("\n=== HEURISTIC ENTITIES (sample) ===");
let entitySample = 0;
for (const chunk of chunks.slice(0, 30)) {
  const entities = extractEntities(chunk.contentPlain);
  if (entities.length > 0 && entitySample < 10) {
    console.log(`  "${chunk.title.substring(0, 50)}":`);
    for (const e of entities) {
      const noiseTag = isNoiseTopic(e.name) ? " [FILTERED]" : "";
      console.log(`    → ${e.name}${noiseTag}`);
    }
    entitySample++;
  }
}
