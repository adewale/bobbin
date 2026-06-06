#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INDEX = process.env.VECTORIZE_INDEX || "bobbin-chunks";
const DB = process.env.D1_DB || "bobbin-db";
const CONFIG = process.env.WRANGLER_CONFIG || "wrangler.remote.jsonc";
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 500);
const GET_BATCH = Number(process.env.GET_BATCH || 20);
const UPSERT_BATCH = Number(process.env.UPSERT_BATCH || 500);
const DELETE_BATCH = Number(process.env.DELETE_BATCH || 100);
const DRY_RUN = process.env.DRY_RUN === "1";

function runWrangler(args, options = {}) {
  const result = spawnSync("npx", ["wrangler", ...args, "--config", CONFIG], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 200,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function parseJsonFromOutput(output) {
  const startArray = output.indexOf("[");
  const startObject = output.indexOf("{");
  const starts = [startArray, startObject].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error(`No JSON found in output: ${output.slice(0, 500)}`);
  const start = Math.min(...starts);
  const text = output.slice(start).trim();
  return JSON.parse(text);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function listVectors(cursor) {
  const args = ["vectorize", "list-vectors", INDEX, "--count", String(PAGE_SIZE), "--json"];
  if (cursor) args.push("--cursor", cursor);
  return JSON.parse(runWrangler(args));
}

function getVectors(ids) {
  const args = ["vectorize", "get-vectors", INDEX, "--ids", ...ids];
  return parseJsonFromOutput(runWrangler(args));
}

function getMetadata(ids) {
  if (ids.length === 0) return new Map();
  const idList = ids.map(sqlString).join(",");
  const sql = `SELECT c.id, c.vector_id, e.published_date, e.year, COALESCE(json_group_array(t.slug) FILTER (WHERE t.slug IS NOT NULL), '[]') AS topic_slugs FROM chunks c JOIN episodes e ON c.episode_id = e.id LEFT JOIN chunk_topics ct ON ct.chunk_id = c.id LEFT JOIN topics t ON t.id = ct.topic_id AND t.hidden = 0 AND t.display_suppressed = 0 WHERE c.vector_id IN (${idList}) GROUP BY c.id;`;
  const output = runWrangler(["d1", "execute", DB, "--remote", "--command", sql]);
  const parsed = parseJsonFromOutput(output);
  const rows = parsed?.[0]?.results ?? [];
  return new Map(rows.map((row) => [row.vector_id, row]));
}

function parseTopics(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function upsertVectors(vectors) {
  if (vectors.length === 0 || DRY_RUN) return;
  for (const batch of chunk(vectors, UPSERT_BATCH)) {
    const file = join(tmpdir(), `bobbin-vectorize-${Date.now()}-${Math.random().toString(16).slice(2)}.ndjson`);
    writeFileSync(file, batch.map((vector) => JSON.stringify(vector)).join("\n") + "\n");
    try {
      runWrangler(["vectorize", "upsert", INDEX, "--file", file, "--batch-size", String(UPSERT_BATCH)]);
    } finally {
      unlinkSync(file);
    }
  }
}

function deleteVectors(ids) {
  if (ids.length === 0 || DRY_RUN) return;
  for (const batch of chunk(ids, DELETE_BATCH)) {
    runWrangler(["vectorize", "delete-vectors", INDEX, "--ids", ...batch]);
  }
}

let cursor;
let pages = 0;
let seen = 0;
let upserted = 0;
let stale = 0;

while (true) {
  const page = listVectors(cursor);
  pages += 1;
  const ids = (page.vectors ?? []).map((vector) => vector.id);
  if (ids.length === 0) break;
  seen += ids.length;

  const metadata = getMetadata(ids);
  const toUpsert = [];
  const toDelete = [];

  for (const idBatch of chunk(ids, GET_BATCH)) {
    const vectors = getVectors(idBatch);
    for (const vector of vectors) {
      const row = metadata.get(vector.id);
      if (!row) {
        toDelete.push(vector.id);
        continue;
      }
      toUpsert.push({
        id: vector.id,
        values: vector.values,
        metadata: {
          chunkId: row.id,
          publishedDate: row.published_date,
          year: row.year,
          topics: parseTopics(row.topic_slugs),
        },
      });
    }
    process.stderr.write(`\rpages=${pages} seen=${seen} prepared_upsert=${upserted + toUpsert.length} prepared_stale=${stale + toDelete.length}`);
  }

  upsertVectors(toUpsert);
  deleteVectors(toDelete);
  upserted += toUpsert.length;
  stale += toDelete.length;
  process.stderr.write(`\rpages=${pages} seen=${seen} upserted=${upserted} stale_deleted=${stale}`);

  if (!page.isTruncated || !page.nextCursor) break;
  cursor = page.nextCursor;
}

process.stderr.write("\n");
console.log(JSON.stringify({ pages, seen, upserted, staleDeleted: stale, dryRun: DRY_RUN }, null, 2));
