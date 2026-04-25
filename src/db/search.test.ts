import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseSearchQuery } from "../lib/query-parser";
import { keywordSearch } from "./search";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Ep 1', '2024-04-08', 2024, 4, 8, 0)"
    ),
    env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('massive topic', 'massive-topic', 140)"
    ),
  ]);
});

describe("keywordSearch", () => {
  it("handles topic filters whose matching chunk pool exceeds the D1 bind cap", async () => {
    const chunkInserts = Array.from({ length: 140 }, (_, index) => {
      const n = index + 1;
      return env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, ?, ?, ?, ?, ?)"
      ).bind(
        `massive-keyword-${n}`,
        `Massive keyword chunk ${n}`,
        `ecosystem keyword note ${n}`,
        `ecosystem keyword note ${n}`,
        n,
      );
    });
    await env.DB.batch(chunkInserts);

    const topicAssignments = Array.from({ length: 140 }, (_, index) =>
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(index + 1)
    );
    await env.DB.batch(topicAssignments);

    const results = await keywordSearch(env.DB, parseSearchQuery("ecosystem topic:massive-topic"));

    expect(results).toHaveLength(20);
    expect(results.every((result) => result.slug.startsWith("massive-keyword-"))).toBe(true);
    expect(results[0]?.published_date).toBe("2024-04-08");
    expect(results.some((result) => result.slug === "massive-keyword-140")).toBe(true);
  });
});
