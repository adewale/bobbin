import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { getEpisodeRailInsights, getEpisodeTopicsBlended } from "./episodes";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, 'ep-prev', 'Previous', '2024-01-01', 2024, 1, 1, 1)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, 'ep-current', 'Current', '2024-02-01', 2024, 2, 1, 2)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'prev-chunk', 'Prev chunk', 'previous episode context', 'previous episode context', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'current-a', 'Current A', 'current chunk A', 'current chunk A', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'current-b', 'Current B', 'current chunk B', 'current chunk B', 1)"
    ),
  ]);
});

describe("episode topic queries under large topic pools", () => {
  it("blends episode topics when the qualifying topic list exceeds the D1 bind cap", async () => {
    const topicInserts = Array.from({ length: 140 }, (_, index) => {
      const n = index + 1;
      return env.DB.prepare(
        "INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES (?, ?, 10, ?)"
      ).bind(`Episode topic ${n}`, `episode-topic-${n}`, n / 10);
    });
    await env.DB.batch(topicInserts);

    const chunkTopicAssignments = Array.from({ length: 140 }, (_, index) => {
      const topicId = index + 1;
      return [
        env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, ?)").bind(topicId),
        env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, ?)").bind(topicId),
      ];
    }).flat();
    const episodeTopicAssignments = Array.from({ length: 140 }, (_, index) => {
      const topicId = index + 1;
      return [
        env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, ?)").bind(topicId),
        env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, ?)").bind(topicId),
      ];
    }).flat();
    await env.DB.batch([...chunkTopicAssignments, ...episodeTopicAssignments]);

    const blended = await getEpisodeTopicsBlended(env.DB, 2, 5, 5);

    expect(blended.main).toHaveLength(5);
    expect(blended.distinctive).toHaveLength(5);
    expect(blended.main.every((topic) => topic.slug.startsWith("episode-topic-"))).toBe(true);
    expect(blended.distinctive.every((topic) => topic.slug.startsWith("episode-topic-"))).toBe(true);
  });

  it("computes rail insights when current-episode topic pools exceed the D1 bind cap", async () => {
    const topicInserts = Array.from({ length: 140 }, (_, index) => {
      const n = index + 1;
      return env.DB.prepare(
        "INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES (?, ?, 10, ?)"
      ).bind(`Rail topic ${n}`, `rail-topic-${n}`, n / 5);
    });
    await env.DB.batch(topicInserts);

    const currentAssignments = Array.from({ length: 140 }, (_, index) => {
      const topicId = index + 1;
      return [
        env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, ?)").bind(topicId),
        env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, ?)").bind(topicId),
        env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, ?)").bind(topicId),
      ];
    }).flat();
    const previousAssignments = Array.from({ length: 60 }, (_, index) =>
      env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, ?)").bind(index + 1)
    );
    await env.DB.batch([...currentAssignments, ...previousAssignments]);

    const insights = await getEpisodeRailInsights(env.DB, 2, "2024-02-01");

    expect(insights.unexpectedPairings.length).toBe(4);
    expect(insights.mostNovelChunks).toHaveLength(2);
    expect(insights.sinceLast.newTopics.length).toBe(3);
    expect(insights.sinceLast.previousEpisode?.slug).toBe("ep-prev");
  });
});
