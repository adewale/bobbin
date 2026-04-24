/**
 * Local pipeline: runs the full ingest → enrich → finalize loop against real
 * HTML data using the same local D1 database that wrangler.local.jsonc-backed
 * dev servers use (via Miniflare/getPlatformProxy).
 *
 * Usage:
 *   npx tsx scripts/local-pipeline.ts           # 3 episodes (default)
 *   npx tsx scripts/local-pipeline.ts 10         # 10 episodes
 *   npx tsx scripts/local-pipeline.ts all        # all episodes
 *   npx tsx scripts/local-pipeline.ts 5 --clean  # wipe local DB first
 *   npx tsx scripts/local-pipeline.ts all --config wrangler.local.jsonc
 *
 * The local D1 persists at .wrangler/state/v3/d1/ — you can inspect it with:
 *   npx wrangler d1 execute bobbin-db --local --config wrangler.local.jsonc --command "SELECT ..."
 */
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { parseHtmlDocument } from "../src/services/html-parser";
import { ingestEpisodesOnly, enrichAllChunks, finalizeEnrichment } from "../src/jobs/ingest";
import { ensureSource } from "../src/db/sources";
import { LOCAL_DEV_WRANGLER_CONFIG_PATH } from "../src/lib/local-dev-config";
import { applyTestMigrations } from "../test/helpers/migrations";

const args = process.argv.slice(2);
const configFlagIndex = args.indexOf("--config");
const configPath = configFlagIndex >= 0 ? args[configFlagIndex + 1] : LOCAL_DEV_WRANGLER_CONFIG_PATH;
if (configFlagIndex >= 0 && !configPath) {
  throw new Error("--config requires a path");
}
const positionalArgs = args.filter((arg, index) => {
  if (arg === "--clean" || arg === "--config") return false;
  if (configFlagIndex >= 0 && index === configFlagIndex + 1) return false;
  return true;
});
const episodeLimit = positionalArgs[0];
const shouldClean = args.includes("--clean");
const maxEpisodes = episodeLimit === "all" ? Infinity : parseInt(episodeLimit || "3", 10);

async function main() {
  console.log("Starting local pipeline...");
  const totalStart = Date.now();

  // Get local D1 binding via Miniflare
  const { env, dispose } = await getPlatformProxy({ configPath });
  const db = env.DB as D1Database;

  try {
    // Apply schema (drop + recreate — same schema as test helpers)
    if (shouldClean) {
      console.log("\n--- Cleaning local DB (drop + recreate) ---");
    }
    // Always apply migrations — idempotent (drops then creates)
    await applyTestMigrations(db);
    console.log("Schema applied");

    // Parse HTML files
    const dataDir = "./data/raw";
    const files = readdirSync(dataDir).filter(f => f.endsWith(".html"));
    if (files.length === 0) {
      console.error("No HTML files found in data/raw/");
      return;
    }

    let allEpisodes: ReturnType<typeof parseHtmlDocument> = [];
    for (const file of files) {
      console.log(`\n--- Parsing ${file} ---`);
      const parseStart = Date.now();
      const html = readFileSync(`${dataDir}/${file}`, "utf-8");
      const episodes = parseHtmlDocument(html);
      console.log(`  ${episodes.length} episodes, ${episodes.reduce((s, e) => s + e.chunks.length, 0)} chunks (${Date.now() - parseStart}ms)`);

      // Tag by source
      const docId = file.replace(".html", "");
      await ensureSource(db, docId, `Source: ${file.substring(0, 20)}`);

      allEpisodes.push(...episodes.map(ep => ({ ...ep, _sourceDocId: docId })));
    }

    // Limit episodes
    const selected = allEpisodes.slice(0, maxEpisodes);
    const totalChunks = selected.reduce((s, e) => s + e.chunks.length, 0);
    console.log(`\n--- Ingesting ${selected.length} of ${allEpisodes.length} episodes (${totalChunks} chunks) ---`);

    // Group by source for ingestion
    const bySource = new Map<string, typeof selected>();
    for (const ep of selected) {
      const docId = (ep as any)._sourceDocId;
      if (!bySource.has(docId)) bySource.set(docId, []);
      bySource.get(docId)!.push(ep);
    }

    let totalIngested = { episodes: 0, chunks: 0 };
    for (const [docId, episodes] of bySource) {
      const source = await db.prepare("SELECT id FROM sources WHERE google_doc_id = ?").bind(docId).first<{ id: number }>();
      if (!source) continue;
      const ingestStart = Date.now();
      const result = await ingestEpisodesOnly(db, source.id, episodes);
      totalIngested.episodes += result.episodesAdded;
      totalIngested.chunks += result.chunksAdded;
      console.log(`  ${docId.substring(0, 12)}...: +${result.episodesAdded} episodes, +${result.chunksAdded} chunks (${Date.now() - ingestStart}ms)`);
    }

    if (totalIngested.chunks === 0) {
      console.log("  No new chunks to process (already ingested?)");
      // Check for unenriched chunks
      const unenriched = await db.prepare("SELECT COUNT(*) as c FROM chunks WHERE enriched = 0").first<{ c: number }>();
      if (unenriched && unenriched.c > 0) {
        console.log(`  Found ${unenriched.c} unenriched chunks from previous run`);
      } else {
        console.log("  All chunks already enriched. Use --clean to start fresh.");
      }
    }

    // Enrich
    console.log(`\n--- Enriching ---`);
    const enrichStart = Date.now();
    const enriched = await enrichAllChunks(db, 200, 120000);
    console.log(`  Enriched ${enriched} chunks (${Date.now() - enrichStart}ms)`);

    // Finalize
    console.log(`\n--- Finalizing ---`);
    const finStart = Date.now();
    const finResult = await finalizeEnrichment(db);
    console.log(`  Completed in ${Date.now() - finStart}ms`);
    console.log(`  Steps:`);
    for (const step of finResult.steps) {
      const status = step.status === "ok" ? "✓" : "✗";
      const detail = step.detail ? ` (${step.detail})` : "";
      const error = step.error ? ` ERROR: ${step.error}` : "";
      console.log(`    ${status} ${step.name}: ${step.duration_ms}ms${detail}${error}`);
    }
    console.log(`  Noise removed: ${finResult.noise_removed}`);
    console.log(`  Pruned: ${finResult.pruned}`);
    console.log(`  Related slugs: ${finResult.related_slugs_method}`);

    // Summary
    console.log(`\n--- Summary ---`);
    const stats = await db.batch([
      db.prepare("SELECT COUNT(*) as c FROM episodes"),
      db.prepare("SELECT COUNT(*) as c FROM chunks"),
      db.prepare("SELECT COUNT(*) as c FROM topics WHERE usage_count > 0"),
      db.prepare("SELECT COUNT(*) as c FROM topics WHERE kind = 'entity' AND usage_count > 0"),
      db.prepare("SELECT COUNT(*) as c FROM topics WHERE kind = 'phrase' AND usage_count > 0"),
      db.prepare("SELECT COUNT(*) as c FROM chunks WHERE enriched = 0"),
      db.prepare("SELECT COUNT(*) as c FROM chunk_topics"),
    ]);
    const [episodes, chunks, topics, entities, phrases, unenriched, chunkTopics] = stats.map(
      (r: any) => (r.results[0] as any).c as number
    );
    console.log(`  Episodes: ${episodes}`);
    console.log(`  Chunks: ${chunks} (${unenriched} unenriched)`);
    console.log(`  Topics: ${topics} (${entities} entities, ${phrases} phrases)`);
    console.log(`  Chunk-topic links: ${chunkTopics}`);

    // Top topics
    const topTopics = await db.prepare(
      "SELECT name, usage_count, kind FROM topics WHERE usage_count > 0 ORDER BY usage_count DESC LIMIT 15"
    ).all<{ name: string; usage_count: number; kind: string }>();
    console.log(`\n  Top 15 topics:`);
    for (const t of topTopics.results) {
      const kindTag = t.kind !== "concept" ? ` [${t.kind}]` : "";
      console.log(`    ${t.usage_count.toString().padStart(4)}  ${t.name}${kindTag}`);
    }

    console.log(`\n  Total time: ${Date.now() - totalStart}ms`);

  } finally {
    await dispose();
  }
}

main().catch(e => {
  console.error("Pipeline failed:", e);
  process.exit(1);
});
