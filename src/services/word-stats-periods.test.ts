import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { detectWordStatsPeriod, rebuildWordStatsPeriods } from "./word-stats-periods";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-01-15', 'Ep 1', '2024-01-15', 2024, 1, 15, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-02-10', 'Ep 2', '2024-02-10', 2024, 2, 10, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1', 'C1', 'A', 'A', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'c2', 'C2', 'B', 'B', 0)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 2)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'ecosystem', 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'platform', 3)"),
  ]);
});

describe("word stats periods", () => {
  it("detects exact month and year windows", () => {
    expect(detectWordStatsPeriod("2024-01-01", "2024-12-31")).toEqual({ periodType: "year", periodKey: "2024" });
    expect(detectWordStatsPeriod("2024-02-01", "2024-02-29")).toEqual({ periodType: "month", periodKey: "2024-02" });
    expect(detectWordStatsPeriod("2024-02-01", "2024-02-28")).toBeNull();
  });

  it("precomputes yearly and monthly word stats", async () => {
    const rows = await rebuildWordStatsPeriods(env.DB);
    expect(rows).toBeGreaterThan(0);

    const year = await env.DB.prepare(
      "SELECT total_count, doc_count FROM word_stats_period WHERE period_type = 'year' AND period_key = '2024' AND word = 'ecosystem'"
    ).first<{ total_count: number; doc_count: number }>();
    expect(year).toEqual({ total_count: 3, doc_count: 2 });

    const feb = await env.DB.prepare(
      "SELECT total_count, doc_count FROM word_stats_period WHERE period_type = 'month' AND period_key = '2024-02' AND word = 'platform'"
    ).first<{ total_count: number; doc_count: number }>();
    expect(feb).toEqual({ total_count: 3, doc_count: 1 });
  });
});
