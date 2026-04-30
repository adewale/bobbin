import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function usage() {
  console.error("Usage: node scripts/compare-pipeline-baselines.mjs <left.json> <right.json>");
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(resolve(filePath), "utf8"));
}

function firstRow(payload) {
  return payload?.[0]?.results?.[0] ?? null;
}

function rows(payload) {
  return payload?.[0]?.results ?? [];
}

export function normalizeCharacterization(payload) {
  return {
    kind: "characterization",
    label: payload.extractorMode ?? "unknown",
    summary: firstRow(payload.summary) ?? {},
    rollup: firstRow(payload.pipelineRollup) ?? {},
    topVisibleTopics: rows(payload.topVisibleTopics).map((row) => ({
      slug: row.slug,
      usage_count: Number(row.usage_count ?? 0),
      kind: row.kind,
    })),
    keyEntities: rows(payload.keyEntities).map((row) => ({
      slug: row.slug,
      usage_count: Number(row.usage_count ?? 0),
      kind: row.kind,
    })),
  };
}

export function normalizeInvariantAudit(payload) {
  return {
    kind: "invariant-audit",
    label: payload.target?.remote ? "remote" : "local",
    counts: payload.counts ?? {},
    support: payload.support ?? {},
    schema: payload.schema ?? {},
  };
}

export function normalize(payload) {
  if (payload?.kind === "invariant-audit") return normalizeInvariantAudit(payload);
  if (payload?.summary && payload?.pipelineRollup) return normalizeCharacterization(payload);
  throw new Error("Unsupported baseline format");
}

export function diffNumberMap(left, right, keys) {
  return keys.map((key) => {
    const leftHas = Object.prototype.hasOwnProperty.call(left ?? {}, key);
    const rightHas = Object.prototype.hasOwnProperty.call(right ?? {}, key);
    const leftValue = leftHas ? Number(left?.[key] ?? 0) : null;
    const rightValue = rightHas ? Number(right?.[key] ?? 0) : null;
    return {
      key,
      left: leftValue,
      right: rightValue,
      delta: leftValue === null || rightValue === null ? null : rightValue - leftValue,
      leftMissing: !leftHas,
      rightMissing: !rightHas,
    };
  });
}

function main() {
  const [leftPath, rightPath] = process.argv.slice(2);
  if (!leftPath || !rightPath) usage();

  const left = normalize(readJson(leftPath));
  const right = normalize(readJson(rightPath));
  if (left.kind !== right.kind) {
    throw new Error(`Cannot compare ${left.kind} to ${right.kind}`);
  }

  if (left.kind === "characterization") {
    const metrics = diffNumberMap(left.summary, right.summary, [
      "episodes",
      "chunks",
      "topics_total",
      "topics_active",
      "topics_visible",
      "active_entities",
      "active_phrases",
      "suppressed_active_topics",
      "weak_visible_singletons",
      "archived_lineage_topics",
      "candidate_rows",
      "candidates_accepted",
      "candidates_rejected",
      "merge_rows",
      "chunk_topic_links",
    ]);
    const rollup = diffNumberMap(left.rollup, right.rollup, [
      "total_pipeline_ms",
      "total_chunks_processed",
      "total_candidates_generated",
      "total_candidates_rejected",
      "total_candidates_inserted",
      "total_pruned",
      "total_merged",
      "total_archived_lineage_topics",
    ]);

    console.log(JSON.stringify({
      kind: left.kind,
      left: left.label,
      right: right.label,
      metrics,
      rollup,
      topVisibleTopics: {
        left: left.topVisibleTopics.map((topic) => topic.slug),
        right: right.topVisibleTopics.map((topic) => topic.slug),
      },
      keyEntities: {
        left: left.keyEntities,
        right: right.keyEntities,
      },
    }, null, 2));
    return;
  }

  const metrics = diffNumberMap(left.counts, right.counts, Object.keys({ ...left.counts, ...right.counts }).sort());
  console.log(JSON.stringify({
    kind: left.kind,
    left: left.label,
    right: right.label,
    schema: { left: left.schema, right: right.schema },
    support: { left: left.support, right: right.support },
    metrics,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
