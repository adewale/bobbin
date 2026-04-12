import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { extractTopics } from "../services/topic-extractor";
import { enrichChunks, ingestEpisodesOnly } from "./ingest";
import { parseHtmlDocument } from "../services/html-parser";
import sampleHtml from "../../test/fixtures/sample-mobilebasic.html?raw";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES ('test-doc', 'Test')"
  ).run();
});

describe("Phase 8: Enrichment pipeline improvements", () => {
  describe("Remove the 5-topic cap", () => {
    it("extractTopics returns more than 5 topics for rich content", () => {
      const richText = `
        The ecosystem dynamics of platform markets are fascinating. LLMs are transforming
        the software industry through agent architectures and swarm intelligence. Prompt
        injection remains a critical security concern. Cognitive labor is being augmented
        by vibe coding practices. The tech industry continues to evolve with emergent
        behaviors in collective intelligence systems. Resonant ideas spread through
        leverage points in complex adaptive systems. ChatGPT and Claude represent different
        approaches to artificial intelligence development.
      `;
      const topics = extractTopics(richText);
      expect(topics.length).toBeGreaterThan(5);
    });
  });

  describe("Auto-merge split concepts", () => {
    it("creates merged 'prompt injection' topic when both parts co-occur", async () => {
      const episodes = parseHtmlDocument(sampleHtml);
      await ingestEpisodesOnly(env.DB, 1, episodes);

      const epResult = await env.DB.prepare("SELECT id FROM episodes LIMIT 1").first<{ id: number }>();
      await env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count)
         VALUES (?, 'test-prompt-injection', 'Prompt Injection',
         'Prompt injection is a serious security issue. Prompt injection attacks exploit vulnerabilities.',
         'Prompt injection is a serious security issue. Prompt injection attacks exploit vulnerabilities.',
         99, 20)`
      ).bind(epResult!.id).run();

      await env.DB.prepare("INSERT OR IGNORE INTO topics (name, slug, kind) VALUES ('prompt', 'prompt', 'concept')").run();
      await env.DB.prepare("INSERT OR IGNORE INTO topics (name, slug, kind) VALUES ('injection', 'injection', 'concept')").run();

      const promptTopic = await env.DB.prepare("SELECT id FROM topics WHERE slug = 'prompt'").first<{ id: number }>();
      const injectionTopic = await env.DB.prepare("SELECT id FROM topics WHERE slug = 'injection'").first<{ id: number }>();
      const testChunk = await env.DB.prepare("SELECT id FROM chunks WHERE slug = 'test-prompt-injection'").first<{ id: number }>();

      await env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(testChunk!.id, promptTopic!.id).run();
      await env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(testChunk!.id, injectionTopic!.id).run();

      await enrichChunks(env.DB, 1000);

      const merged = await env.DB.prepare("SELECT * FROM topics WHERE slug = 'prompt-injection'").first();
      expect(merged).not.toBeNull();
      expect((merged as any).name).toBe("prompt injection");
    });

    it("merged topic has correct usage_count", async () => {
      const episodes = parseHtmlDocument(sampleHtml);
      await ingestEpisodesOnly(env.DB, 1, episodes);

      const epResult = await env.DB.prepare("SELECT id FROM episodes LIMIT 1").first<{ id: number }>();
      await env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count)
         VALUES (?, 'test-pi-1', 'PI 1', 'prompt injection text', 'prompt injection text', 97, 10)`
      ).bind(epResult!.id).run();
      await env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count)
         VALUES (?, 'test-pi-2', 'PI 2', 'prompt injection other', 'prompt injection other', 98, 10)`
      ).bind(epResult!.id).run();

      await env.DB.prepare("INSERT OR IGNORE INTO topics (name, slug, kind) VALUES ('prompt', 'prompt', 'concept')").run();
      await env.DB.prepare("INSERT OR IGNORE INTO topics (name, slug, kind) VALUES ('injection', 'injection', 'concept')").run();

      const promptTopic = await env.DB.prepare("SELECT id FROM topics WHERE slug = 'prompt'").first<{ id: number }>();
      const injectionTopic = await env.DB.prepare("SELECT id FROM topics WHERE slug = 'injection'").first<{ id: number }>();
      const chunk1 = await env.DB.prepare("SELECT id FROM chunks WHERE slug = 'test-pi-1'").first<{ id: number }>();
      const chunk2 = await env.DB.prepare("SELECT id FROM chunks WHERE slug = 'test-pi-2'").first<{ id: number }>();

      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(chunk1!.id, promptTopic!.id),
        env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(chunk1!.id, injectionTopic!.id),
        env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(chunk2!.id, promptTopic!.id),
        env.DB.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(chunk2!.id, injectionTopic!.id),
      ]);

      await enrichChunks(env.DB, 1000);

      const merged = await env.DB.prepare("SELECT usage_count FROM topics WHERE slug = 'prompt-injection'").first<{ usage_count: number }>();
      expect(merged).not.toBeNull();
      expect(merged!.usage_count).toBe(2);
    });
  });

  describe("Precompute distinctiveness", () => {
    it("topics with matching word_stats entries have non-zero distinctiveness", async () => {
      const episodes = parseHtmlDocument(sampleHtml);
      await ingestEpisodesOnly(env.DB, 1, episodes);

      await env.DB.prepare(
        "INSERT OR IGNORE INTO word_stats (word, total_count, doc_count, distinctiveness) VALUES ('ecosystem', 100, 10, 25.5)"
      ).run();

      await enrichChunks(env.DB, 1000);

      const topicsWithDist = await env.DB.prepare(
        "SELECT name, distinctiveness FROM topics WHERE distinctiveness > 0"
      ).all();
      expect(topicsWithDist.results.length).toBeGreaterThan(0);
    });
  });

  describe("Precompute related_slugs", () => {
    it("topics with usage >= 3 have non-null related_slugs", async () => {
      const episodes = parseHtmlDocument(sampleHtml);
      await ingestEpisodesOnly(env.DB, 1, episodes);
      await enrichChunks(env.DB, 1000);

      const popularTopics = await env.DB.prepare(
        "SELECT id, slug, related_slugs FROM topics WHERE usage_count >= 3"
      ).all();

      expect(popularTopics.results.length).toBeGreaterThan(0);

      for (const topic of popularTopics.results as any[]) {
        expect(topic.related_slugs).not.toBeNull();
        const parsed = JSON.parse(topic.related_slugs);
        expect(Array.isArray(parsed)).toBe(true);
      }
    });
  });
});
