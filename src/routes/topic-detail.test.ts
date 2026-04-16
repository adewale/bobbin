import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('s1', 'Source')"),

    // Two episodes
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-04-08-ep', 'Episode 1', '2024-04-08', 2024, 4, 8, 2, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-05-01-ep', 'Episode 2', '2024-05-01', 2024, 5, 1, 1, 'notes')"
    ),

    // Three chunks — chunk 1 and 2 share topics (for co-occurrence), chunk 3 is in episode 2
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-llms', 'LLMs are transforming', '<p>LLMs content</p>', 'The future of llms is agents that can orchestrate other models to accomplish complex tasks.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-agents', 'Agents overview', '<p>Agents</p>', 'Agents and llms work together in swarm architectures.', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-claude', 'Claude Code thoughts', '<p>Claude Code</p>', 'Claude code is an interesting product built on llms.', 0)"
    ),

    // Topics: "llms" (single word, has word_stats), "agents" (single word), "claude code" (multi-word, no word_stats)
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 3)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('agents', 'agents', 2)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('claude code', 'claude-code', 1)"),

    // chunk_topics: llms on all 3 chunks, agents on chunk 1+2 (co-occurs with llms), claude code on chunk 3
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),

    // episode_topics
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 3)"),

    // word_stats: entry for "llms" (single word) — none for "claude code"
    env.DB.prepare(
      "INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES ('llms', 1036, 710, 113.6, 0)"
    ),
    env.DB.prepare(
      "INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES ('agents', 200, 90, 25.3, 0)"
    ),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedData();
});

describe("Topic detail page — word_stats integration", () => {
  it("shows mention count from word_stats when available", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("1,036 mentions");
  });

  it("shows distinctiveness when available", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).toContain("113.6");
    expect(html).toContain("distinctiveness");
  });

  it("shows related topics from co-occurrence", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    // "agents" co-occurs with "llms" on chunk 1 and 2, so should appear as related
    expect(html).toContain("Related");
    expect(html).toContain('href="/topics/agents"');
  });

  it("highlights topic name in chunk excerpts with <mark>", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).toContain("<mark>");
    // The word "llms" should be wrapped in mark tags (case-insensitive)
    expect(html).toMatch(/<mark>llms<\/mark>/i);
  });

  it("works when word_stats has no entry for a multi-word topic", async () => {
    const res = await SELF.fetch("http://localhost/topics/claude-code");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should still show chunk and episode counts without mention count / distinctiveness
    expect(html).toContain("claude code");
    expect(html).not.toContain("mentions");
    expect(html).not.toContain("distinctiveness");
  });

  it("returns 404 for display-suppressed topics", async () => {
    await env.DB.prepare(
      "INSERT INTO topics (name, slug, usage_count, display_suppressed, display_reason) VALUES ('hidden concept', 'hidden-concept', 12, 1, 'subsumed_by_phrase')"
    ).run();

    const res = await SELF.fetch("http://localhost/topics/hidden-concept");

    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain("hidden concept");
  });
});
