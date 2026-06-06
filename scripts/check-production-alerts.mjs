#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "8837d43caf5a2ab3df5143eb3e2f1b96";
const DB = process.env.D1_DB || "bobbin-db";
const CONFIG = process.env.WRANGLER_CONFIG || "wrangler.remote.jsonc";
const DLQ_NAME = process.env.DLQ_NAME || "bobbin-enrichment-dlq";
const STALE_RUNNING_MINUTES = Number(process.env.STALE_RUNNING_MINUTES || 30);
const FAILED_REFRESH_HOURS = Number(process.env.FAILED_REFRESH_HOURS || 24);
const COST_WINDOW_MINUTES = Number(process.env.COST_WINDOW_MINUTES || 60);
const WORKERS_AI_EVENT_THRESHOLD = Number(process.env.WORKERS_AI_EVENT_THRESHOLD || 500);
const WORKERS_AI_UNIT_THRESHOLD = Number(process.env.WORKERS_AI_UNIT_THRESHOLD || 5000);
const VECTORIZE_EVENT_THRESHOLD = Number(process.env.VECTORIZE_EVENT_THRESHOLD || 1000);
const VECTORIZE_UNIT_THRESHOLD = Number(process.env.VECTORIZE_UNIT_THRESHOLD || 5_000_000);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function parseJson(output) {
  const starts = [output.indexOf("["), output.indexOf("{")].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error(`No JSON found in output: ${output.slice(0, 500)}`);
  return JSON.parse(output.slice(Math.min(...starts)).trim());
}

function d1(sql) {
  const output = run("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--command", sql]);
  const parsed = parseJson(output);
  return parsed.flatMap((entry) => entry.results ?? []);
}

async function cfApi(path, init = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required for Cloudflare API alert checks");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok || body.success === false) {
    throw new Error(`Cloudflare API ${path} failed ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`);
  }
  return body.result;
}

async function checkDlq() {
  const queues = await cfApi(`/accounts/${ACCOUNT_ID}/queues`);
  const queue = (Array.isArray(queues) ? queues : queues?.queues ?? []).find((item) => item.queue_name === DLQ_NAME || item.name === DLQ_NAME);
  if (!queue) return { status: "alert", summary: `DLQ ${DLQ_NAME} not found`, details: {} };
  const queueId = queue.queue_id || queue.id;
  const result = await cfApi(`/accounts/${ACCOUNT_ID}/queues/${queueId}/messages/pull`, {
    method: "POST",
    body: JSON.stringify({ visibility_timeout: 1000, batch_size: 1 }),
  });
  const messages = Array.isArray(result) ? result : result?.messages ?? [];
  return messages.length > 0
    ? { status: "alert", summary: `${DLQ_NAME} has at least ${messages.length} message(s)`, details: { queueId, sampled: messages.length } }
    : { status: "ok", summary: `${DLQ_NAME} empty`, details: { queueId } };
}

function checkD1State() {
  const [staleRunning] = d1(
    `SELECT COUNT(*) AS count FROM ingestion_log WHERE status = 'running' AND started_at < datetime('now', '-${STALE_RUNNING_MINUTES} minutes')`
  );
  const failedRefreshes = d1(
    `SELECT id, run_type, started_at, completed_at, error_message
     FROM ingestion_log
     WHERE run_type IN ('refresh', 'refresh_cycle')
       AND status = 'failed'
       AND completed_at >= datetime('now', '-${FAILED_REFRESH_HOURS} hours')
       AND instr(COALESCE(error_message, ''), 'Marked failed during production audit remediation:') != 1
     ORDER BY completed_at DESC
     LIMIT 10`
  );
  const costRows = d1(
    `SELECT product, operation, COUNT(*) AS events, COALESCE(SUM(units), 0) AS units FROM cloudflare_cost_events WHERE created_at >= datetime('now', '-${COST_WINDOW_MINUTES} minutes') GROUP BY product, operation ORDER BY product, operation`
  );

  const checks = [];
  checks.push(Number(staleRunning?.count ?? 0) > 0
    ? { status: "alert", summary: `${staleRunning.count} ingestion_log row(s) running for >${STALE_RUNNING_MINUTES}m`, details: staleRunning }
    : { status: "ok", summary: `No ingestion logs running >${STALE_RUNNING_MINUTES}m`, details: staleRunning });

  checks.push(failedRefreshes.length > 0
    ? { status: "alert", summary: `${failedRefreshes.length} failed refresh log(s) in last ${FAILED_REFRESH_HOURS}h`, details: failedRefreshes }
    : { status: "ok", summary: `No failed refreshes in last ${FAILED_REFRESH_HOURS}h`, details: [] });

  for (const row of costRows) {
    const events = Number(row.events ?? 0);
    const units = Number(row.units ?? 0);
    if (row.product === "workers_ai" && (events > WORKERS_AI_EVENT_THRESHOLD || units > WORKERS_AI_UNIT_THRESHOLD)) {
      checks.push({ status: "alert", summary: `Workers AI spike: ${row.operation} events=${events} units=${units} in ${COST_WINDOW_MINUTES}m`, details: row });
    }
    if (row.product === "vectorize" && (events > VECTORIZE_EVENT_THRESHOLD || units > VECTORIZE_UNIT_THRESHOLD)) {
      checks.push({ status: "alert", summary: `Vectorize spike: ${row.operation} events=${events} units=${units} in ${COST_WINDOW_MINUTES}m`, details: row });
    }
  }
  if (!checks.some((check) => check.summary.includes("Workers AI spike"))) {
    checks.push({ status: "ok", summary: `Workers AI below thresholds in ${COST_WINDOW_MINUTES}m`, details: costRows.filter((row) => row.product === "workers_ai") });
  }
  if (!checks.some((check) => check.summary.includes("Vectorize spike"))) {
    checks.push({ status: "ok", summary: `Vectorize below thresholds in ${COST_WINDOW_MINUTES}m`, details: costRows.filter((row) => row.product === "vectorize") });
  }

  return checks;
}

async function sendAlert(payload) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  const text = [`Bobbin production alert: ${payload.alerts.length} issue(s)`, ...payload.alerts.map((alert) => `• ${alert.summary}`)].join("\n");
  const body = url.includes("discord") ? { content: text } : { text, payload };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Alert webhook failed ${response.status}: ${await response.text()}`);
  return true;
}

async function main() {
  const checks = [...checkD1State()];
  try {
    checks.push(await checkDlq());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = message.includes("http_pull mode is enabled")
      ? ` Run: npx wrangler queues consumer http add ${DLQ_NAME} --config ${CONFIG} --visibility-timeout-secs 1`
      : "";
    checks.push({ status: "alert", summary: `DLQ check failed: ${message}${hint}`, details: {} });
  }

  const alerts = checks.filter((check) => check.status === "alert");
  const payload = {
    generatedAt: new Date().toISOString(),
    target: { accountId: ACCOUNT_ID, db: DB, config: CONFIG, dlq: DLQ_NAME },
    healthy: alerts.length === 0,
    checks,
    alerts,
  };

  if (alerts.length > 0) await sendAlert(payload);
  console.log(JSON.stringify(payload, null, 2));
  if (alerts.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
