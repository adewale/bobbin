#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "8837d43caf5a2ab3df5143eb3e2f1b96";
const INDEX = process.env.VECTORIZE_INDEX || "bobbin-chunks";
const DB = process.env.D1_DB || "bobbin-db";
const CONFIG = process.env.WRANGLER_CONFIG || "wrangler.remote.jsonc";
const MODEL = "@cf/baai/bge-base-en-v1.5";
const AI_BATCH = Number(process.env.AI_BATCH || 50);
const MAX_TEXT_CHARS = Number(process.env.MAX_TEXT_CHARS || 6000);
const UPSERT_BATCH = Number(process.env.UPSERT_BATCH || 500);
const LIMIT = Number(process.env.LIMIT || 0);
const DRY_RUN = process.env.DRY_RUN === "1";

function wrangler(args, options = {}) {
  const result = spawnSync("npx", ["wrangler", ...args, "--config", CONFIG], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 200,
    ...options,
  });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function parseJson(output) {
  const starts = [output.indexOf("["), output.indexOf("{")].filter((i) => i >= 0);
  if (!starts.length) throw new Error(`No JSON in output: ${output.slice(0, 500)}`);
  return JSON.parse(output.slice(Math.min(...starts)).trim());
}

function parseWranglerToken() {
  const path = `${process.env.HOME}/Library/Preferences/.wrangler/config/default.toml`;
  const text = readFileSync(path, "utf8");
  const match = /^oauth_token\s*=\s*"([^"]+)"/m.exec(text);
  if (!match) throw new Error("No wrangler oauth_token found");
  return match[1];
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseTopics(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function listVectorIds() {
  const ids = new Set();
  let cursor;
  while (true) {
    const args = ["vectorize", "list-vectors", INDEX, "--count", "1000", "--json"];
    if (cursor) args.push("--cursor", cursor);
    const page = JSON.parse(wrangler(args));
    for (const vector of page.vectors ?? []) ids.add(vector.id);
    process.stderr.write(`\rvectorize_ids=${ids.size}`);
    if (!page.isTruncated || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  process.stderr.write("\n");
  return ids;
}

function listD1Vectors() {
  const sql = `SELECT c.id, c.vector_id, c.content_plain, e.published_date, e.year, COALESCE(json_group_array(t.slug) FILTER (WHERE t.slug IS NOT NULL), '[]') AS topic_slugs FROM chunks c JOIN episodes e ON c.episode_id = e.id LEFT JOIN chunk_topics ct ON ct.chunk_id = c.id LEFT JOIN topics t ON t.id = ct.topic_id AND t.hidden = 0 AND t.display_suppressed = 0 WHERE c.vector_id IS NOT NULL GROUP BY c.id ORDER BY c.id ASC;`;
  const parsed = parseJson(wrangler(["d1", "execute", DB, "--remote", "--command", sql]));
  return parsed?.[0]?.results ?? [];
}

async function embed(texts, token) {
  const normalized = texts.map((text) => String(text || " ").slice(0, MAX_TEXT_CHARS) || " ");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: normalized }),
  });
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok || body.success === false) throw new Error(`AI embedding failed ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`);
  return body.result?.data ?? body.result ?? body.data;
}

async function embedRows(rows, token) {
  try {
    return await embed(rows.map((row) => row.content_plain), token);
  } catch (error) {
    if (rows.length === 1) {
      console.error(`\nskipping vector_id=${rows[0].vector_id}: ${error instanceof Error ? error.message : String(error)}`);
      return [null];
    }
    const mid = Math.ceil(rows.length / 2);
    const left = await embedRows(rows.slice(0, mid), token);
    const right = await embedRows(rows.slice(mid), token);
    return [...left, ...right];
  }
}

function upsert(vectors) {
  if (!vectors.length || DRY_RUN) return;
  for (const batch of chunk(vectors, UPSERT_BATCH)) {
    const file = join(tmpdir(), `bobbin-missing-vectors-${Date.now()}-${Math.random().toString(16).slice(2)}.ndjson`);
    writeFileSync(file, batch.map((vector) => JSON.stringify(vector)).join("\n") + "\n");
    try {
      wrangler(["vectorize", "upsert", INDEX, "--file", file, "--batch-size", String(UPSERT_BATCH)]);
    } finally {
      unlinkSync(file);
    }
  }
}

const token = parseWranglerToken();
const existing = listVectorIds();
const rows = listD1Vectors();
let missing = rows.filter((row) => row.vector_id && !existing.has(row.vector_id));
if (LIMIT > 0) missing = missing.slice(0, LIMIT);
console.error(`missing=${missing.length} dryRun=${DRY_RUN}`);

let embedded = 0;
for (const batch of chunk(missing, AI_BATCH)) {
  const embeddings = await embedRows(batch, token);
  const vectors = batch.map((row, index) => ({
    id: row.vector_id,
    values: embeddings[index],
    metadata: {
      chunkId: row.id,
      publishedDate: row.published_date,
      year: row.year,
      topics: parseTopics(row.topic_slugs),
    },
  })).filter((vector) => Array.isArray(vector.values));
  upsert(vectors);
  embedded += vectors.length;
  process.stderr.write(`\rembedded=${embedded}/${missing.length}`);
}
process.stderr.write("\n");
console.log(JSON.stringify({ d1Vectors: rows.length, existingVectors: existing.size, missing: missing.length, embedded, dryRun: DRY_RUN }, null, 2));
