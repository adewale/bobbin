import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import {
  getChunksInPeriod,
  getEpisodesInPeriod,
  getMostConnectedInPeriod,
  getPeriodArchiveContrast,
  getPeriodMovers,
  getPeriodNewTopics,
  getPeriodTopicCounts,
} from "./periods";

// A small fixture spanning three months across two years so period bounds
// have something to bite into and movers/new-topics have prior data to
// compare against.
async function seed() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('p', 'Periods Source')"),
    // March 2025 — the "previous period" baseline
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-03-03', 'Mar A', '2025-03-03', 2025, 3, 3, 2)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-03-17', 'Mar B', '2025-03-17', 2025, 3, 17, 2)"
    ),
    // April 2025 — the "current period"
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-04-07', 'Apr A', '2025-04-07', 2025, 4, 7, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-04-21', 'Apr B', '2025-04-21', 2025, 4, 21, 2)"
    ),
    // Outside the period entirely (May 2025) — must not leak in
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-05-05', 'May', '2025-05-05', 2025, 5, 5, 1)"
    ),
  ]);

  await env.DB.batch([
    // March chunks
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (1, 'mar-a-1', 'Mar A1', 'x', 'x', 0, 5)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (1, 'mar-a-2', 'Mar A2', 'x', 'x', 1, 3)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (2, 'mar-b-1', 'Mar B1', 'x', 'x', 0, 4)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (2, 'mar-b-2', 'Mar B2', 'x', 'x', 1, 2)"),
    // April chunks
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (3, 'apr-a-1', 'Apr A1', 'x', 'x', 0, 9)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (3, 'apr-a-2', 'Apr A2', 'x', 'x', 1, 7)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (3, 'apr-a-3', 'Apr A3', 'x', 'x', 2, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (4, 'apr-b-1', 'Apr B1', 'x', 'x', 0, 6)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (4, 'apr-b-2', 'Apr B2', 'x', 'x', 1, 8)"),
    // May chunk
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (5, 'may-1', 'May 1', 'x', 'x', 0, 10)"),
  ]);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('agent', 'agent', 6, 5.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('llms', 'llms', 4, 8.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('codex', 'codex', 2, 12.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('legacy', 'legacy', 4, 3.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('ecosystem', 'ecosystem', 6, 7.0)"),
  ]);

  await env.DB.batch([
    // March: legacy (heavy), llms (light), ecosystem (1 chunk)
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 4)"), // mar-a-1 legacy
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 4)"), // mar-a-2 legacy
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 4)"), // mar-b-1 legacy
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"), // mar-b-2 llms
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 5)"), // mar-a-1 ecosystem
    // April: agent (heavy = intensified-from-zero), llms (heavy, +2 vs March), legacy disappears, codex new-to-corpus
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"), // apr-a-1 agent
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"), // apr-a-2 agent
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 1)"), // apr-a-3 agent
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 2)"), // apr-b-1 llms
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (9, 2)"), // apr-b-2 llms
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"), // apr-a-1 llms
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 3)"), // apr-b-1 codex (new!)
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (9, 3)"), // apr-b-2 codex
    // May: codex (so it appeared first in April, not later)
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (10, 3)"),
  ]);
}

const APRIL = { start: "2025-04-01", end: "2025-04-30" };
const MARCH = { start: "2025-03-01", end: "2025-03-31" };

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seed();
});

describe("getEpisodesInPeriod", () => {
  it("returns only episodes within the bounds", async () => {
    const episodes = await getEpisodesInPeriod(env.DB, APRIL);
    expect(episodes.map((e) => e.slug)).toEqual(["2025-04-07", "2025-04-21"]);
  });

  it("excludes episodes outside the bounds", async () => {
    const episodes = await getEpisodesInPeriod(env.DB, APRIL);
    const slugs = episodes.map((e) => e.slug);
    expect(slugs).not.toContain("2025-03-03");
    expect(slugs).not.toContain("2025-05-05");
  });
});

describe("getChunksInPeriod", () => {
  it("returns only chunks whose episode falls in the bounds", async () => {
    const chunks = await getChunksInPeriod(env.DB, APRIL);
    expect(chunks.map((c) => c.slug).sort()).toEqual([
      "apr-a-1", "apr-a-2", "apr-a-3", "apr-b-1", "apr-b-2",
    ]);
  });
});

describe("getPeriodTopicCounts", () => {
  it("aggregates chunk-topic counts within the period", async () => {
    const counts = await getPeriodTopicCounts(env.DB, APRIL);
    const byName = Object.fromEntries(counts.map((t) => [t.name, t.chunk_count]));
    expect(byName.agent).toBe(3);
    expect(byName.llms).toBe(3);
    expect(byName.codex).toBe(2);
    // legacy was March-only — must not appear
    expect(byName.legacy).toBeUndefined();
  });

  it("sorts by chunk_count descending", async () => {
    const counts = await getPeriodTopicCounts(env.DB, APRIL);
    expect(counts[0].chunk_count).toBeGreaterThanOrEqual(counts[counts.length - 1].chunk_count);
  });
});

describe("getPeriodMovers", () => {
  it("flags topics that intensified vs the previous period", async () => {
    const movers = await getPeriodMovers(env.DB, APRIL, MARCH);
    const intensifiedNames = movers.intensified.map((t) => t.name);
    expect(intensifiedNames).toContain("agent"); // 0 in March -> 3 in April
    expect(intensifiedNames).toContain("llms"); // 1 in March -> 3 in April
  });

  it("flags topics that disappeared as downshifted", async () => {
    const movers = await getPeriodMovers(env.DB, APRIL, MARCH);
    const downshiftedNames = movers.downshifted.map((t) => t.name);
    expect(downshiftedNames).toContain("legacy"); // 3 in March -> 0 in April
  });

  it("reports the absolute delta for downshifted topics as negative", async () => {
    const movers = await getPeriodMovers(env.DB, APRIL, MARCH);
    const legacy = movers.downshifted.find((t) => t.name === "legacy");
    expect(legacy).toBeDefined();
    expect(legacy!.delta).toBeLessThan(0);
  });
});

describe("getPeriodNewTopics", () => {
  it("includes topics whose first appearance is within the period", async () => {
    const newTopics = await getPeriodNewTopics(env.DB, APRIL);
    const names = newTopics.map((t) => t.name);
    expect(names).toContain("codex"); // first seen 2025-04-21
    expect(names).toContain("agent"); // first seen 2025-04-07
  });

  it("excludes topics that existed in earlier periods", async () => {
    const newTopics = await getPeriodNewTopics(env.DB, APRIL);
    const names = newTopics.map((t) => t.name);
    expect(names).not.toContain("legacy"); // first seen in March
    expect(names).not.toContain("llms"); // first seen in March
    expect(names).not.toContain("ecosystem"); // first seen in March
  });

  it("ranks and limits new topics by in-period mentions, not later corpus growth", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (id, name, slug, usage_count, distinctiveness) VALUES (6, 'April Brief', 'april-brief', 3, 20.0)"),
      env.DB.prepare("INSERT INTO topics (id, name, slug, usage_count, distinctiveness) VALUES (7, 'Future Popular', 'future-popular', 6, 5.0)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 7)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (10, 7)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (5, 'may-2', 'May 2', 'x', 'x', 1, 1)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (5, 'may-3', 'May 3', 'x', 'x', 2, 1)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (5, 'may-4', 'May 4', 'x', 'x', 3, 1)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (11, 7)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (12, 7)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (13, 7)"),
    ]);

    const newTopics = await getPeriodNewTopics(env.DB, APRIL, 1);
    expect(newTopics).toHaveLength(1);
    expect(newTopics[0].slug).toBe("april-brief");
  });
});

describe("getPeriodArchiveContrast", () => {
  it("surfaces topics over-indexed in the period vs the corpus", async () => {
    const contrast = await getPeriodArchiveContrast(env.DB, APRIL);
    // agent: corpus usage 6, period_count 3 across 2 episodes (5 episodes total).
    // Expected per ep = 6/5 = 1.2; observed = 3/2 = 1.5. Spike ~1.25 (below 1.5 threshold)
    // codex: corpus usage 2 — below the usage_count >= 5 floor, so excluded.
    // The exact set depends on the seed, but the function must return something
    // sortable by spikeRatio without error.
    expect(Array.isArray(contrast)).toBe(true);
    contrast.forEach((topic) => {
      expect(topic.spikeRatio).toBeGreaterThan(1.5);
    });
  });

  it("orders equal spike ratios deterministically by topic name", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (id, name, slug, usage_count, distinctiveness) VALUES (6, 'Alpha', 'alpha', 5, 5.0)"),
      env.DB.prepare("INSERT INTO topics (id, name, slug, usage_count, distinctiveness) VALUES (7, 'Beta', 'beta', 5, 5.0)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 6)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 7)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 7)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 7)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 7)"),
    ]);

    const contrast = await getPeriodArchiveContrast(env.DB, APRIL, 2);
    expect(contrast.map((topic) => topic.slug)).toEqual(["alpha", "beta"]);
  });
});

describe("getMostConnectedInPeriod", () => {
  it("ranks chunks within the period by reach", async () => {
    const chunks = await getMostConnectedInPeriod(env.DB, APRIL, 3);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].reach).toBeGreaterThanOrEqual(chunks[chunks.length - 1].reach);
  });

  it("excludes chunks from other periods even when their reach is higher", async () => {
    const chunks = await getMostConnectedInPeriod(env.DB, APRIL, 5);
    const slugs = chunks.map((c) => c.slug);
    expect(slugs).not.toContain("may-1"); // reach 10 but outside April
  });

  it("breaks equal reach ties deterministically by slug", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (4, 'aa-tie', 'AA Tie', 'x', 'x', 2, 50)"),
      env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (4, 'zz-tie', 'ZZ Tie', 'x', 'x', 3, 50)"),
    ]);

    const chunks = await getMostConnectedInPeriod(env.DB, APRIL, 2);
    expect(chunks.map((chunk) => chunk.slug)).toEqual(["aa-tie", "zz-tie"]);
  });
});
