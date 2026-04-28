import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { getRelatedTopics, getTopTopicsWithSparklines, getTrendingTopicsForEpisode } from "./topics";
import { chunkForSqlBindings } from "../lib/db";

function legacyTopicSchemaDb(db: D1Database): D1Database {
  const wrap = (sql: string, statement: D1PreparedStatement): D1PreparedStatement => ({
    bind: (...args: unknown[]) => wrap(sql, statement.bind(...args)),
    first: async (...args: unknown[]) => {
      if (/SELECT\s+name\s+FROM\s+sqlite_master/i.test(sql)) return null;
      if (/episode_support/i.test(sql)) {
        throw new Error("D1_ERROR: no such column: episode_support at offset 59: SQLITE_ERROR");
      }
      if (/topic_similarity_scores/i.test(sql)) {
        throw new Error("D1_ERROR: no such table: topic_similarity_scores: SQLITE_ERROR");
      }
      return statement.first(...args as []);
    },
    all: async (...args: unknown[]) => {
      if (/PRAGMA\s+table_info\(topics\)/i.test(sql)) {
        const result = await statement.all(...args as []);
        return {
          ...result,
          results: (result.results as Array<{ name?: string }>).filter((row) => row.name !== "episode_support"),
        };
      }
      if (/SELECT\s+name\s+FROM\s+sqlite_master/i.test(sql)) {
        const result = await statement.all(...args as []);
        return { ...result, results: [] };
      }
      if (/episode_support/i.test(sql)) {
        throw new Error("D1_ERROR: no such column: episode_support at offset 59: SQLITE_ERROR");
      }
      if (/topic_similarity_scores/i.test(sql)) {
        throw new Error("D1_ERROR: no such table: topic_similarity_scores: SQLITE_ERROR");
      }
      return statement.all(...args as []);
    },
    raw: (...args: unknown[]) => statement.raw(...args as []),
    run: (...args: unknown[]) => statement.run(...args as []),
  } as D1PreparedStatement);

  return {
    prepare: (sql: string) => wrap(sql, db.prepare(sql)),
    batch: (...args: Parameters<D1Database["batch"]>) => db.batch(...args),
    exec: (...args: Parameters<D1Database["exec"]>) => db.exec(...args),
    dump: (...args: Parameters<D1Database["dump"]>) => db.dump(...args),
  } as D1Database;
}

async function seedTopicData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('topics', 'Topics Source')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-01-08', 'Ep 1', '2024-01-08', 2024, 1, 8, 2)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-02-12', 'Ep 2', '2024-02-12', 2024, 2, 12, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-03-18', 'Ep 3', '2024-03-18', 2024, 3, 18, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-22', 'Ep 4', '2024-04-22', 2024, 4, 22, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-05-27', 'Ep 5', '2024-05-27', 2024, 5, 27, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1', 'Chunk 1', 'LLMs and agents', 'LLMs and agents', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-2', 'Chunk 2', 'LLMs and security', 'LLMs and security', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-3', 'Chunk 3', 'Agents alone', 'Agents alone', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'chunk-4', 'Chunk 4', 'Security alone', 'Security alone', 0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('llms', 'llms', 4, 9)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('agents', 'agents', 3, 7)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('security', 'security', 3, 6)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedTopicData();
});

describe("chunkForSqlBindings", () => {
  it("preserves order while keeping every SQL batch under the configured cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10_000 }), { maxLength: 250 }),
        fc.integer({ min: 1, max: 25 }),
        (values, maxBindings) => {
          const chunks = chunkForSqlBindings(values, maxBindings);

          expect(chunks.flat()).toEqual(values);
          expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= maxBindings)).toBe(true);
          expect(chunks.length).toBe(Math.ceil(values.length / maxBindings));
        },
      ),
    );
  });

  it("rejects non-positive SQL batch sizes", () => {
    expect(() => chunkForSqlBindings([1, 2, 3], 0)).toThrow("maxBindings must be positive");
    expect(() => chunkForSqlBindings([1, 2, 3], -1)).toThrow("maxBindings must be positive");
  });
});

describe("topics legacy schema fallback", () => {
  it("renders trending topics for an episode without episode_support", async () => {
    const trending = await getTrendingTopicsForEpisode(legacyTopicSchemaDb(env.DB), 1, 5);

    expect(trending.map((topic) => topic.slug)).toContain("llms");
  });

  it("builds topic multiples without episode_support", async () => {
    const topics = await getTopTopicsWithSparklines(legacyTopicSchemaDb(env.DB), 5);

    expect(topics.map((topic) => topic.slug)).toEqual(expect.arrayContaining(["llms", "agents", "security"]));
  });

  it("falls back to co-occurrence when similarity cache tables are missing", async () => {
    const related = await getRelatedTopics(legacyTopicSchemaDb(env.DB), 1, 5);

    expect(related.map((topic) => topic.slug)).toEqual(expect.arrayContaining(["agents", "security"]));
  });
});
