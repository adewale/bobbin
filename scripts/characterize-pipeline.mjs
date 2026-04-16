import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const mode = process.argv[2] === "yaket" ? "yaket" : "naive";
const port = mode === "yaket" ? 8796 : 8795;
const adminSecret = "characterize-secret";
const stateDir = mkdtempSync(join(tmpdir(), `bobbin-characterize-${mode}-`));
const batchLimit = mode === "yaket" ? 10 : 100;

const docs = [
  "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0",
  "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw",
  "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA",
  "1x8z6k07JqXTVIRVNr1S_7wYVl5L7IpX14gXxU1UBrGk",
];
const ingestDocs = docs.slice(0, 3);

function run(command, args, { ignoreFailure = false } = {}) {
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
      if (code !== 0 && !ignoreFailure) {
        reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

async function runJson(command, args) {
  const { stdout } = await run(command, args);
  return JSON.parse(stdout);
}

async function waitForServer(url, headers) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const dev = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--config",
      "wrangler.local.jsonc",
      "--port",
      String(port),
      "--persist-to",
      stateDir,
      "--var",
      `ADMIN_SECRET:${adminSecret}`,
      "--var",
      `TOPIC_EXTRACTOR_MODE:${mode}`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let devLog = "";
  dev.stdout.on("data", (chunk) => {
    devLog += String(chunk);
  });
  dev.stderr.on("data", (chunk) => {
    devLog += String(chunk);
  });

  try {
    await run("npx", [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "bobbin-db",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--persist-to",
      stateDir,
    ]);

    await run("npx", [
      "wrangler",
      "d1",
      "execute",
      "bobbin-db",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--persist-to",
      stateDir,
      "--command",
      `INSERT OR IGNORE INTO sources (google_doc_id, title) VALUES
        ('${docs[0]}', 'Bits and Bobs (Archive Essays)'),
        ('${docs[1]}', 'Bits and Bobs (Archive Notes)'),
        ('${docs[2]}', 'Bits and Bobs (Current)'),
        ('${docs[3]}', 'Bits and Bobs (Empty)');`,
    ]);

    await waitForServer(`http://127.0.0.1:${port}/api/health`, {
      Authorization: `Bearer ${adminSecret}`,
    });

    const ingestResults = [];
    for (const docId of ingestDocs) {
      let remaining = Infinity;
      const docLimit = docId === docs[0] ? 100 : batchLimit;
      while (remaining > 0) {
        const res = await fetch(`http://127.0.0.1:${port}/api/ingest?doc=${docId}&limit=${docLimit}`, {
          headers: { Authorization: `Bearer ${adminSecret}` },
        });
        const body = await res.json();
        if (!res.ok) {
          const latestFailure = await runJson("npx", [
            "wrangler",
            "d1",
            "execute",
            "bobbin-db",
            "--local",
            "--config",
            "wrangler.local.jsonc",
            "--persist-to",
            stateDir,
            "--json",
            "--command",
            "SELECT status, error_message, pipeline_report FROM ingestion_log ORDER BY id DESC LIMIT 1;",
          ]);
          throw new Error(`Ingest failed for ${docId}: ${JSON.stringify(body)}\n\nLATEST LOG:\n${JSON.stringify(latestFailure)}\n\nDEV LOG:\n${devLog.slice(-12000)}`);
        }
        ingestResults.push(body);
        remaining = typeof body.remaining === "number" ? body.remaining : 0;
        if ((body.episodesIngested || 0) === 0 && remaining === 0) break;
      }
    }

    const summary = await runJson("npx", [
      "wrangler",
      "d1",
      "execute",
      "bobbin-db",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--persist-to",
      stateDir,
      "--json",
      "--command",
      `SELECT
         (SELECT COUNT(*) FROM sources) AS sources,
         (SELECT COUNT(*) FROM episodes) AS episodes,
         (SELECT COUNT(*) FROM chunks) AS chunks,
         (SELECT COUNT(*) FROM topics) AS topics_total,
         (SELECT COUNT(*) FROM topics WHERE usage_count > 0) AS topics_active,
         (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND hidden = 0 AND display_suppressed = 0) AS topics_visible,
         (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND kind = 'entity') AS active_entities,
         (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND kind = 'phrase') AS active_phrases,
         (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND display_suppressed = 1) AS suppressed_active_topics,
         (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND hidden = 0 AND display_suppressed = 0 AND kind != 'entity' AND name NOT LIKE '% %' AND distinctiveness < 20) AS weak_visible_singletons,
         (SELECT COUNT(*) FROM topic_lineage_archive) AS archived_lineage_topics,
         (SELECT COUNT(*) FROM topic_candidate_audit) AS candidate_rows,
         (SELECT COUNT(*) FROM topic_candidate_audit WHERE decision = 'accepted') AS candidates_accepted,
         (SELECT COUNT(*) FROM topic_candidate_audit WHERE decision = 'rejected') AS candidates_rejected,
         (SELECT COUNT(*) FROM phrase_lexicon) AS phrase_lexicon_rows,
         (SELECT COUNT(*) FROM topic_merge_audit) AS merge_rows,
         (SELECT COUNT(*) FROM chunk_topics) AS chunk_topic_links,
         (SELECT COUNT(*) FROM chunk_words) AS chunk_word_rows,
         (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND provenance_complete = 1) AS active_topics_with_provenance;`,
    ]);

    const topVisibleTopics = await runJson("npx", [
      "wrangler",
      "d1",
      "execute",
      "bobbin-db",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--persist-to",
      stateDir,
      "--json",
      "--command",
      `SELECT name, slug, kind, usage_count, distinctiveness
       FROM topics
       WHERE usage_count > 0 AND hidden = 0 AND display_suppressed = 0
       ORDER BY usage_count DESC, distinctiveness DESC, name ASC
       LIMIT 20;`,
    ]);

    const keyEntities = await runJson("npx", [
      "wrangler",
      "d1",
      "execute",
      "bobbin-db",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--persist-to",
      stateDir,
      "--json",
      "--command",
      `SELECT slug, usage_count, kind
       FROM topics
       WHERE slug IN ('openai','chatgpt','claude','claude-code','anthropic','google','meta','microsoft','apple')
       ORDER BY slug ASC;`,
    ]);

    const pipelineRuns = await runJson("npx", [
      "wrangler",
      "d1",
      "execute",
      "bobbin-db",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--persist-to",
      stateDir,
      "--json",
      "--command",
      `SELECT run_type, extractor_mode, status, total_ms, chunks_processed,
              candidates_generated, candidates_rejected_early, candidates_inserted,
              topics_inserted, pruned, merged, orphan_topics_deleted, archived_lineage_topics
       FROM pipeline_runs
       ORDER BY id DESC
       LIMIT 8;`,
    ]);

    const pipelineRollup = await runJson("npx", [
      "wrangler",
      "d1",
      "execute",
      "bobbin-db",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--persist-to",
      stateDir,
      "--json",
      "--command",
      `SELECT
         COALESCE(SUM(total_ms), 0) AS total_pipeline_ms,
         COALESCE(SUM(chunks_processed), 0) AS total_chunks_processed,
         COALESCE(SUM(candidates_generated), 0) AS total_candidates_generated,
         COALESCE(SUM(candidates_rejected_early), 0) AS total_candidates_rejected,
         COALESCE(SUM(candidates_inserted), 0) AS total_candidates_inserted,
         COALESCE(SUM(pruned), 0) AS total_pruned,
         COALESCE(SUM(merged), 0) AS total_merged,
         COALESCE(SUM(archived_lineage_topics), 0) AS total_archived_lineage_topics
       FROM pipeline_runs
       WHERE run_type = 'manual_ingest';`,
    ]);

    const result = {
      extractorMode: mode,
      ingestResults,
      summary,
      topVisibleTopics,
      keyEntities,
      pipelineRuns,
      pipelineRollup,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    dev.kill("SIGTERM");
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
