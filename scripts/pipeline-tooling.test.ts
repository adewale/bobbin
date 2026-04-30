import { describe, expect, it } from "vitest";
import { diffNumberMap, normalizeCharacterization } from "./compare-pipeline-baselines.mjs";
import { deriveSupportContext } from "./audit-invariant-metrics.mjs";
import { buildRestoreOrder, shouldSkipRollbackTable } from "./export-rollback-bundle.mjs";

describe("pipeline tooling helpers", () => {
  it("normalizes characterization keyEntities without duplicating the entire payload", () => {
    const normalized = normalizeCharacterization({
      extractorMode: "naive",
      summary: [{ results: [{ topics_visible: 3 }] }],
      pipelineRollup: [{ results: [{ total_pipeline_ms: 123 }] }],
      topVisibleTopics: [{ results: [{ slug: "llms", usage_count: 10, kind: "concept" }] }],
      keyEntities: [{ results: [{ slug: "openai", usage_count: 5, kind: "entity" }] }],
    });

    expect(normalized.keyEntities).toEqual([{ slug: "openai", usage_count: 5, kind: "entity" }]);
    expect(normalized.topVisibleTopics).toEqual([{ slug: "llms", usage_count: 10, kind: "concept" }]);
  });

  it("matches app fallback semantics when episode_support exists but is unpopulated", () => {
    expect(deriveSupportContext({
      hasEpisodeSupport: true,
      totalEpisodes: 81,
      populatedEpisodeSupportTopics: 0,
    })).toEqual({ hasEpisodeSupport: true, minEpisodeSupport: 0 });
  });

  it("skips internal and FTS shadow tables in rollback bundles", () => {
    expect(shouldSkipRollbackTable("_cf_METADATA", "CREATE TABLE _cf_METADATA ...")).toEqual({ skip: true, reason: "reserved table" });
    expect(shouldSkipRollbackTable("d1_migrations", "CREATE TABLE d1_migrations ...")).toEqual({ skip: true, reason: "migration bookkeeping table" });
    expect(shouldSkipRollbackTable("chunks_fts_data", "CREATE TABLE chunks_fts_data ...")).toEqual({ skip: true, reason: "FTS shadow table" });
    expect(shouldSkipRollbackTable("chunks_fts", "CREATE VIRTUAL TABLE chunks_fts USING fts5(title)")).toEqual({ skip: true, reason: "FTS shadow table" });
    expect(shouldSkipRollbackTable("topics", "CREATE TABLE topics (id INTEGER PRIMARY KEY)")).toEqual({ skip: false, reason: null });
  });

  it("builds a parent-before-child restore order", () => {
    const order = buildRestoreOrder(
      ["chunks", "episodes", "chunk_topics", "topics"],
      {
        episodes: [],
        topics: [],
        chunks: [{ parentTable: "episodes" }],
        chunk_topics: [{ parentTable: "chunks" }, { parentTable: "topics" }],
      },
    );

    expect(order.indexOf("episodes")).toBeLessThan(order.indexOf("chunks"));
    expect(order.indexOf("chunks")).toBeLessThan(order.indexOf("chunk_topics"));
    expect(order.indexOf("topics")).toBeLessThan(order.indexOf("chunk_topics"));
  });

  it("reports missing metrics instead of coercing them to zero", () => {
    const diff = diffNumberMap({ a: 1 }, { a: 2, b: 3 }, ["a", "b"]);

    expect(diff).toEqual([
      { key: "a", left: 1, right: 2, delta: 1, leftMissing: false, rightMissing: false },
      { key: "b", left: null, right: 3, delta: null, leftMissing: true, rightMissing: false },
    ]);
  });
});
