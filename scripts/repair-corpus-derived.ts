import process from "node:process";
import { spawn } from "node:child_process";
import { computeDistinctiveness, loadEnglishBaseline } from "../src/services/distinctiveness";
import { computeSpanAwareBurstScore, quarterKeyFromIsoDate } from "../src/lib/topic-metrics";

interface Options {
  remote: boolean;
  db: string;
  config: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    remote: false,
    db: "bobbin-db",
    config: "wrangler.jsonc",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--remote") {
      options.remote = true;
      continue;
    }
    if (arg === "--db") {
      options.db = argv[index + 1] || options.db;
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.config = argv[index + 1] || options.config;
      index += 1;
    }
  }

  return options;
}

function run(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
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

function buildWranglerArgs(options: Options, sql: string) {
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
  args.splice(4, 0, options.remote ? "--remote" : "--local");
  return args;
}

async function query(options: Options, sql: string) {
  const { stdout } = await run("npx", buildWranglerArgs(options, sql));
  return JSON.parse(stdout) as Array<{ results: any[] }>;
}

function unwrapRows(payload: Array<{ results: any[] }>) {
  return payload?.[0]?.results ?? [];
}

function unwrapFirst(payload: Array<{ results: any[] }>) {
  return unwrapRows(payload)[0] ?? null;
}

function sqlString(value: string | null) {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

async function execBatch(options: Options, statements: string[]) {
  const BATCH_SIZE = 100;
  for (let index = 0; index < statements.length; index += BATCH_SIZE) {
    const batch = statements.slice(index, index + BATCH_SIZE);
    if (batch.length === 0) continue;
    await query(options, batch.join("; "));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const topicColumns = unwrapRows(await query(options, "PRAGMA table_info(topics);"));
  const hasEpisodeSupport = topicColumns.some((column) => column.name === "episode_support");
  const hasBurstScore = topicColumns.some((column) => column.name === "burst_score");

  await query(options, [
    "DELETE FROM episode_topics",
    `INSERT OR IGNORE INTO episode_topics (episode_id, topic_id)
     SELECT DISTINCT c.episode_id, ct.topic_id
     FROM chunk_topics ct
     JOIN chunks c ON c.id = ct.chunk_id`,
    `UPDATE topics
     SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = topics.id)`,
    hasEpisodeSupport
      ? `UPDATE topics
         SET episode_support = (
           SELECT COUNT(DISTINCT et.episode_id)
           FROM episode_topics et
           WHERE et.topic_id = topics.id
         )`
      : "SELECT 1",
    "DELETE FROM word_stats WHERE word NOT IN (SELECT DISTINCT word FROM chunk_words)",
    `INSERT INTO word_stats (word, total_count, doc_count, updated_at)
     SELECT word, SUM(count) as total_count, COUNT(DISTINCT chunk_id) as doc_count, datetime('now')
     FROM chunk_words GROUP BY word
     ON CONFLICT(word) DO UPDATE SET
       total_count = excluded.total_count,
       doc_count = excluded.doc_count,
       updated_at = excluded.updated_at`,
  ].join("; "));

  const wordRows = unwrapRows(await query(options, "SELECT word, total_count FROM word_stats ORDER BY word ASC;"));
  const corpusFreq = new Map<string, number>();
  let totalWords = 0;
  for (const row of wordRows) {
    corpusFreq.set(String(row.word), Number(row.total_count));
    totalWords += Number(row.total_count);
  }
  const baseline = loadEnglishBaseline();
  const distinctiveness = computeDistinctiveness(corpusFreq, Math.max(totalWords, 1), baseline);
  await execBatch(options, distinctiveness.map((row) =>
    `UPDATE word_stats
     SET distinctiveness = ${row.distinctiveness}, in_baseline = ${baseline.has(row.word) ? 1 : 0}, updated_at = datetime('now')
     WHERE word = ${sqlString(row.word)}`
  ));

  await query(options, [
    `UPDATE topics
     SET distinctiveness = COALESCE((SELECT w.distinctiveness FROM word_stats w WHERE w.word = LOWER(topics.name)), 0)`,
    `UPDATE chunks
     SET reach = (
       SELECT COALESCE(SUM(t.usage_count), 0)
       FROM chunk_topics ct
       JOIN topics t ON ct.topic_id = t.id
       WHERE ct.chunk_id = chunks.id AND t.hidden = 0 AND t.display_suppressed = 0
     )`,
  ].join("; "));

  if (hasBurstScore) {
    const mentionRows = unwrapRows(await query(options, `SELECT ct.topic_id, e.published_date, COUNT(*) as mention_count
      FROM chunk_topics ct
      JOIN chunks c ON c.id = ct.chunk_id
      JOIN episodes e ON e.id = c.episode_id
      GROUP BY ct.topic_id, e.published_date
      ORDER BY ct.topic_id ASC, e.published_date ASC;`));
    const countsByTopic = new Map<number, Map<string, number>>();
    const firstQuarterByTopic = new Map<number, string>();
    const lastQuarterByTopic = new Map<number, string>();
    for (const row of mentionRows) {
      const topicId = Number(row.topic_id);
      const quarter = quarterKeyFromIsoDate(String(row.published_date));
      const current = countsByTopic.get(topicId) ?? new Map<string, number>();
      current.set(quarter, (current.get(quarter) ?? 0) + Number(row.mention_count));
      countsByTopic.set(topicId, current);
      if (!firstQuarterByTopic.has(topicId) || quarter < (firstQuarterByTopic.get(topicId) ?? quarter)) firstQuarterByTopic.set(topicId, quarter);
      if (!lastQuarterByTopic.has(topicId) || quarter > (lastQuarterByTopic.get(topicId) ?? quarter)) lastQuarterByTopic.set(topicId, quarter);
    }

    const topicRows = unwrapRows(await query(options, "SELECT id FROM topics ORDER BY id ASC;"));
    await execBatch(options, topicRows.map((row) => {
      const topicId = Number(row.id);
      const burst = computeSpanAwareBurstScore(
        countsByTopic.get(topicId) ?? new Map(),
        firstQuarterByTopic.get(topicId) ?? null,
        lastQuarterByTopic.get(topicId) ?? null,
      );
      return `UPDATE topics SET burst_score = ${burst.score}, burst_peak_quarter = ${sqlString(burst.peakQuarter)} WHERE id = ${topicId}`;
    }));
  }

  const auditArgs = ["scripts/audit-invariant-metrics.mjs"];
  if (options.remote) auditArgs.push("--remote");
  auditArgs.push("--db", options.db, "--config", options.config);
  const { stdout } = await run("node", auditArgs);
  const audit = JSON.parse(stdout);
  console.log(JSON.stringify({
    repaired: true,
    target: { remote: options.remote, db: options.db, config: options.config },
    audit,
  }, null, 2));

  const counts = audit?.counts || {};
  const healthy = Number(counts.orphan_topics || 0) === 0
    && Number(counts.stale_usage_orphans || 0) === 0
    && Number(counts.drifted_episode_chunk_counts || 0) === 0;
  if (!healthy) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
