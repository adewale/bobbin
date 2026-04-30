import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    remote: false,
    db: "bobbin-db",
    config: "wrangler.jsonc",
    persistTo: undefined,
    output: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--remote") {
      options.remote = true;
      continue;
    }
    if (arg === "--db") {
      options.db = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.config = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--persist-to") {
      options.persistTo = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runJson(command, args) {
  const { stdout } = await run(command, args);
  return JSON.parse(stdout);
}

function unwrapRows(payload) {
  return payload?.[0]?.results ?? [];
}

function unwrapFirstRow(payload) {
  return unwrapRows(payload)[0] ?? null;
}

function topicSupportThreshold(totalEpisodes) {
  const safeEpisodes = Math.max(1, Math.floor(totalEpisodes));
  return Math.max(2, Math.ceil(Math.log2(safeEpisodes)));
}

export function deriveSupportContext({ hasEpisodeSupport, totalEpisodes, populatedEpisodeSupportTopics }) {
  if (!hasEpisodeSupport) {
    return {
      hasEpisodeSupport,
      minEpisodeSupport: topicSupportThreshold(totalEpisodes),
    };
  }

  if (populatedEpisodeSupportTopics === 0) {
    return {
      hasEpisodeSupport,
      minEpisodeSupport: 0,
    };
  }

  return {
    hasEpisodeSupport,
    minEpisodeSupport: topicSupportThreshold(totalEpisodes),
  };
}

function buildWranglerArgs(options, sql) {
  const args = [
    "wrangler",
    "d1",
    "execute",
    options.db,
    "--config",
    options.config,
    "--json",
    "--command",
    sql,
  ];

  if (options.remote) {
    args.splice(4, 0, "--remote");
  } else if (options.persistTo) {
    args.splice(4, 0, "--persist-to", options.persistTo);
  } else {
    args.splice(4, 0, "--local");
  }

  return args;
}

async function query(options, sql) {
  return runJson("npx", buildWranglerArgs(options, sql));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const topicColumns = unwrapRows(await query(options, "PRAGMA table_info(topics);"));
  const schemaTables = unwrapRows(await query(
    options,
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  ));
  const totalEpisodesRow = unwrapFirstRow(await query(options, "SELECT COUNT(*) as c FROM episodes;"));

  const hasEpisodeSupport = topicColumns.some((column) => column.name === "episode_support");
  const hasSimilarityTable = schemaTables.some((table) => table.name === "topic_similarity_scores");
  const totalEpisodes = Number(totalEpisodesRow?.c ?? 0);
  const populatedEpisodeSupportRow = hasEpisodeSupport
    ? unwrapFirstRow(await query(options, "SELECT COUNT(*) as c FROM topics WHERE usage_count > 0 AND episode_support > 0;"))
    : { c: 0 };
  const supportContext = deriveSupportContext({
    hasEpisodeSupport,
    totalEpisodes,
    populatedEpisodeSupportTopics: Number(populatedEpisodeSupportRow?.c ?? 0),
  });
  const minEpisodeSupport = supportContext.minEpisodeSupport;
  const supportClause = hasEpisodeSupport
    ? `(episode_support >= ${minEpisodeSupport} OR (episode_support = 0 AND usage_count >= ${minEpisodeSupport}))`
    : `usage_count >= ${Math.max(minEpisodeSupport, 3)}`;

  const countsRow = unwrapFirstRow(await query(
    options,
    `SELECT
       (SELECT COUNT(*) FROM topics) AS total_topics,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0) AS active_topics,
        (SELECT COUNT(*) FROM topics WHERE hidden = 0 AND display_suppressed = 0) AS visible_topics,
        (SELECT COUNT(*) FROM topics WHERE hidden = 0 AND display_suppressed = 0 AND ${supportClause}) AS visible_topics_support_eligible,
        (SELECT COUNT(*) FROM topics WHERE hidden = 0 AND display_suppressed = 0 AND NOT (${supportClause})) AS visible_topics_support_ineligible,
        (SELECT COUNT(*) FROM topics t WHERE NOT EXISTS (SELECT 1 FROM chunk_topics ct WHERE ct.topic_id = t.id)) AS orphan_topics,
        (SELECT COUNT(*) FROM topics t WHERE usage_count > 0 AND NOT EXISTS (SELECT 1 FROM chunk_topics ct WHERE ct.topic_id = t.id)) AS stale_usage_orphans,
        (SELECT COUNT(*) FROM (SELECT slug FROM topics GROUP BY slug HAVING COUNT(*) > 1)) AS duplicate_topic_slugs,
       (SELECT COUNT(*) FROM (
          SELECT e.id
          FROM episodes e
          LEFT JOIN chunks c ON c.episode_id = e.id
          GROUP BY e.id
          HAVING e.chunk_count != COUNT(c.id)
        )) AS drifted_episode_chunk_counts,
       (SELECT COUNT(*) FROM topics WHERE hidden = 0 AND display_suppressed = 0 AND related_slugs IS NULL) AS visible_topics_missing_related_slugs,
       (SELECT COUNT(*) FROM topics WHERE kind = 'entity' AND usage_count > 0 AND entity_verified = 0) AS active_entities_unverified;`
  ));

  const lowSupportVisibleTopics = unwrapRows(await query(
    options,
    `SELECT slug, usage_count${hasEpisodeSupport ? ", episode_support" : ""}
     FROM topics
     WHERE hidden = 0 AND display_suppressed = 0 AND NOT (${supportClause})
     ORDER BY usage_count DESC, slug ASC
     LIMIT 20;`
  ));

  const driftedEpisodes = unwrapRows(await query(
    options,
    `SELECT e.slug, e.chunk_count as stored_chunk_count, COUNT(c.id) as actual_chunk_count
     FROM episodes e
     LEFT JOIN chunks c ON c.episode_id = e.id
     GROUP BY e.id
     HAVING e.chunk_count != COUNT(c.id)
     ORDER BY e.published_date DESC
     LIMIT 20;`
  ));

  const result = {
    kind: "invariant-audit",
    generatedAt: new Date().toISOString(),
    target: {
      db: options.db,
      config: options.config,
      remote: options.remote,
      persistTo: options.persistTo ?? null,
    },
    schema: {
      hasEpisodeSupport,
      hasSimilarityTable,
      tableNames: schemaTables.map((table) => table.name),
    },
    support: {
      totalEpisodes,
      minEpisodeSupport,
      populatedEpisodeSupportTopics: Number(populatedEpisodeSupportRow?.c ?? 0),
    },
    counts: Object.fromEntries(
      Object.entries(countsRow ?? {}).map(([key, value]) => [key, Number(value ?? 0)])
    ),
    samples: {
      lowSupportVisibleTopics,
      driftedEpisodes,
    },
  };

  const json = JSON.stringify(result, null, 2);
  if (options.output) {
    const filePath = resolve(options.output);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${json}\n`);
  }
  console.log(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
