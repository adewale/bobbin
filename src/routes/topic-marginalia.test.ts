import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedWithTopics() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('doc1', 'Source 1')"),
    // Episode with topics
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-01-06-topics', 'Bits and Bobs 1/6/25', '2025-01-06', 2025, 1, 6, 2, 'notes')"
    ),
    // Episode without topics
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-01-13-empty', 'Bits and Bobs 1/13/25', '2025-01-13', 2025, 1, 13, 1, 'notes')"
    ),
    // Chunks for episode with topics
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'llm-agents-2025-01-06', 'LLM agents are evolving', 'LLM agents are evolving.\nThey can now orchestrate other models.', 'LLM agents are evolving. They can now orchestrate other models.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'vibe-coding-2025-01-06', 'Vibe coding is real', 'Vibe coding is real.\nJust describe what you want.', 'Vibe coding is real. Just describe what you want.', 1)"
    ),
    // Chunk for episode without topics
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'bare-note-2025-01-13', 'A bare note', 'A bare note.\nNo topics here.', 'A bare note. No topics here.', 0)"
    ),
    // Topics (tags table)
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 10)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('agent', 'agent', 8)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('vibe coding', 'vibe-coding', 5)"),
    // Link topics to episode 1
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 3)"),
    // Link topics to chunks
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedWithTopics();
});

describe("Episode page topic marginalia", () => {
  it("shows topics as always-visible marginalia without details/summary", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2025-01-06-topics");
    const html = await res.text();
    expect(res.status).toBe(200);
    // Has the marginalia wrapper
    expect(html).toContain("topics-margin");
    // Does NOT have a details/summary accordion for tags
    // Extract the topics-margin aside element (up to its closing tag)
    const marginStart = html.indexOf("topics-margin");
    const marginEnd = html.indexOf("</aside>", marginStart);
    const marginSection = html.substring(marginStart, marginEnd);
    expect(marginSection).not.toContain("<details");
    expect(marginSection).not.toContain("<summary");
    // Has a visible heading instead
    expect(marginSection).toContain("<h3>Topics</h3>");
  });

  it("does not show marginalia section when episode has no topics", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2025-01-13-empty");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("topics-margin");
  });
});

describe("Chunk page topic marginalia", () => {
  it("shows topics as always-visible marginalia without details/summary", async () => {
    const res = await SELF.fetch("http://localhost/chunks/llm-agents-2025-01-06");
    const html = await res.text();
    expect(res.status).toBe(200);
    // Has the marginalia wrapper
    expect(html).toContain("topics-margin");
    // Does NOT have a details/summary accordion for tags
    const marginStart = html.indexOf("topics-margin");
    const marginEnd = html.indexOf("</aside>", marginStart);
    const marginSection = html.substring(marginStart, marginEnd);
    expect(marginSection).not.toContain("<details");
    expect(marginSection).not.toContain("<summary");
    // Has a visible heading instead
    expect(marginSection).toContain("<h3>Topics</h3>");
  });

  it("does not show marginalia section when chunk has no topics", async () => {
    const res = await SELF.fetch("http://localhost/chunks/bare-note-2025-01-13");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("topics-margin");
  });
});

describe("Topic links in marginalia", () => {
  it("episode page topic links point to /topics/:slug", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2025-01-06-topics");
    const html = await res.text();
    expect(html).toContain('href="/topics/llms"');
    expect(html).toContain('href="/topics/agent"');
    expect(html).toContain('href="/topics/vibe-coding"');
  });

  it("chunk page topic links point to /topics/:slug", async () => {
    const res = await SELF.fetch("http://localhost/chunks/llm-agents-2025-01-06");
    const html = await res.text();
    expect(html).toContain('href="/topics/llms"');
    expect(html).toContain('href="/topics/agent"');
  });
});
