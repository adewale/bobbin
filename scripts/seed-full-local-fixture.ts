import { execFileSync } from "node:child_process";
import { getPlatformProxy } from "wrangler";
import { FULL_PRODUCT_LOCAL_FIXTURE_COMMAND, LOCAL_DEV_WRANGLER_CONFIG_PATH } from "../src/lib/local-dev-config";

const args = process.argv.slice(2);
const configFlagIndex = args.indexOf("--config");
const configPath = configFlagIndex >= 0 ? args[configFlagIndex + 1] : LOCAL_DEV_WRANGLER_CONFIG_PATH;

if (configFlagIndex >= 0 && !configPath) {
  throw new Error("--config requires a path");
}

function run(label: string, command: string, commandArgs: string[]) {
  console.log(`\n=== ${label} ===`);
  execFileSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

async function main() {
  console.log(`Seeding full product local fixture with ${configPath}`);
  console.log(`Canonical command: ${FULL_PRODUCT_LOCAL_FIXTURE_COMMAND}`);

  run("Bootstrap cached corpus", "npx", ["tsx", "scripts/local-pipeline.ts", "all", "--clean", "--config", configPath]);
  run("Seed deterministic episode rail demo", "node", ["scripts/seed-episode-rail-demo.mjs", "--config", configPath]);

  const { env, dispose } = await getPlatformProxy({ configPath });
  const db = env.DB as D1Database;

  try {
    const counts = await db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM episodes) AS episodes,
         (SELECT COUNT(*) FROM chunks) AS chunks,
         (SELECT COUNT(*) FROM topics WHERE usage_count >= 5 AND hidden = 0 AND display_suppressed = 0) AS visible_topics`
    ).first<{ episodes: number; chunks: number; visible_topics: number }>();

    const topTopic = await db.prepare(
      `SELECT slug, name FROM topics
       WHERE usage_count >= 5 AND hidden = 0 AND display_suppressed = 0
       ORDER BY usage_count DESC, distinctiveness DESC, name ASC
       LIMIT 1`
    ).first<{ slug: string; name: string }>();

    const richChunk = await db.prepare(
      `SELECT slug FROM chunks
       WHERE rich_content_json IS NOT NULL AND rich_content_json != '' AND rich_content_json != '[]'
       ORDER BY id DESC
       LIMIT 1`
    ).first<{ slug: string }>();

    const searchQuery = topTopic?.name || "openai";

    console.log("\n=== Fixture ready ===");
    console.log(JSON.stringify({
      configPath,
      episodes: counts?.episodes || 0,
      chunks: counts?.chunks || 0,
      visibleTopics: counts?.visible_topics || 0,
      urls: {
        home: "http://localhost:9090/",
        episodes: "http://localhost:9090/episodes",
        episodeRailDemo: "http://localhost:9090/episodes/2026-05-12-rail-demo",
        chunkRailDemo: "http://localhost:9090/chunks/rail-demo-current-1",
        topics: "http://localhost:9090/topics",
        topicDetail: topTopic ? `http://localhost:9090/topics/${topTopic.slug}` : null,
        richChunk: richChunk ? `http://localhost:9090/chunks/${richChunk.slug}` : null,
        search: `http://localhost:9090/search?q=${encodeURIComponent(searchQuery)}`,
        design: "http://localhost:9090/design",
      },
    }, null, 2));
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error("Full local fixture seed failed:", error);
  process.exit(1);
});
