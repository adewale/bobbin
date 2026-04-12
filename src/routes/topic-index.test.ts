import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedSparklineData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test Source')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-01-08', 'Ep Jan', '2024-01-08', 2024, 1, 8, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-06-15', 'Ep Jun', '2024-06-15', 2024, 6, 15, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-10', 'Ep Jan 25', '2025-01-10', 2025, 1, 10, 3)"
    ),
  ]);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1a', 'LLM Basics', 'LLMs are great', 'LLMs are great', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-1b', 'Agent Design', 'Agent patterns', 'Agent patterns', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-2a', 'LLM Future', 'Future of LLMs', 'Future of LLMs', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-2b', 'Agent Swarms', 'Agent swarm theory', 'Agent swarm theory', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'chunk-3a', 'LLM Agents', 'LLM powered agents', 'LLM powered agents', 0)"),
  ]);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 10)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('agent', 'agent', 8)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('coding', 'coding', 6)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('simon willison', 'simon-willison', 7)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('claude code', 'claude-code', 5)"),
  ]);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 3)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedSparklineData();
});

describe("Topics index - small multiples grid", () => {
  it("contains multiples-grid with sparkline SVGs", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("multiples-grid");
    expect(html).toContain("multiple-spark");
    expect(html).toContain("<polyline");
  });

  it("shows top topics by usage", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    expect(html).toContain("llms");
    expect(html).toContain("agent");
    expect(html).toContain("coding");
  });

  it("each cell links to topic detail page", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    expect(html).toContain('href="/topics/llms"');
    expect(html).toContain('href="/topics/agent"');
  });

  it("does not show topics with usage < 3 in the grid", async () => {
    // Insert a low-usage topic that should be excluded from the grid
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count) VALUES ('rare-topic', 'rare-topic', 2)"
    ).run();
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    expect(html).not.toContain("rare-topic");
  });

  it("shows usage_count in the HTML for each topic cell", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    // The seed data has topics with usage counts 10, 8, 7, 6, 5
    expect(html).toContain("multiple-count");
    // Verify specific usage counts from seeded data appear
    expect(html).toContain(">10<");
    expect(html).toContain(">8<");
  });
});

describe("Topics index - unified grid", () => {
  it("does not show a separate entity tier section", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    expect(html).not.toContain("People, Products &amp; Phrases");
    expect(html).not.toContain("topic-tier");
  });

  it("shows intro text describing the topic grid", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    expect(html).toContain("page-intro");
    expect(html).toContain("concepts Komoroske returns to most");
  });

  it("includes multi-word topics in the sparkline grid", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    // Multi-word topics with sufficient usage appear in the unified grid
    expect(html).toContain("simon willison");
    expect(html).toContain("claude code");
  });
});

describe("Topics index - search", () => {
  it("search input is present", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    expect(html).toContain('name="q"');
  });
});
