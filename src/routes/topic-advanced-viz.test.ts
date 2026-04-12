import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

/**
 * Seed data spanning 2+ years with multiple topics of varying usage.
 * Topics with usage_count >= 5 qualify for the ThemeRiver.
 */
async function seedMultiYearData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('src1', 'Test Source')"),

    // Episodes across 2 years
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-03-01', 'Ep Mar 24', '2024-03-01', 2024, 3, 1, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-06-15', 'Ep Jun 24', '2024-06-15', 2024, 6, 15, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-01-10', 'Ep Jan 25', '2025-01-10', 2025, 1, 10, 3)"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2025-04-20', 'Ep Apr 25', '2025-04-20', 2025, 4, 20, 3)"
    ),
  ]);

  await env.DB.batch([
    // Episode 1 chunks
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1a', 'LLM Intro', 'LLM content', 'LLM content', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1b', 'Agent Start', 'Agent content', 'Agent content', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'c1c', 'Coding Basics', 'Coding content', 'Coding content', 2)"),

    // Episode 2 chunks
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'c2a', 'LLM Future', 'LLM future', 'LLM future', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'c2b', 'Agent Patterns', 'Agent patterns', 'Agent patterns', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'c2c', 'Vibe Intro', 'Vibe coding', 'Vibe coding', 2)"),

    // Episode 3 chunks
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'c3a', 'LLM Agents', 'LLM agents', 'LLM agents', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'c3b', 'Agent Swarm', 'Agent swarm', 'Agent swarm', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'c3c', 'Coding Tools', 'Coding tools', 'Coding tools', 2)"),

    // Episode 4 chunks
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (4, 'c4a', 'LLM Review', 'LLM review', 'LLM review', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (4, 'c4b', 'Agent Update', 'Agent update', 'Agent update', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (4, 'c4c', 'Vibe Advanced', 'Vibe advanced', 'Vibe advanced', 2)"),
  ]);

  // Topics: all with usage_count >= 5 to qualify for ThemeRiver
  await env.DB.batch([
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 12)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('agent', 'agent', 10)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('coding', 'coding', 6)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('vibe', 'vibe', 5)"),
  ]);

  // chunk_topics: distribute topics across chunks/episodes/years
  await env.DB.batch([
    // llms: present in all 4 episodes
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (10, 1)"),

    // agent: present in all 4 episodes
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (11, 2)"),

    // coding: present in episodes 1 and 3 (2024 and 2025)
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (9, 3)"),

    // vibe: present in episodes 2 and 4 (2024 and 2025)
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 4)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (12, 4)"),
  ]);

  // episode_topics
  await env.DB.batch([
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (4, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (4, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 4)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (4, 4)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedMultiYearData();
});

describe("ThemeRiver on homepage", () => {
  it("contains theme-river-svg when topics exist", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("theme-river-svg");
  });

  it("has path elements for each top topic", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    expect(html).toContain("theme-river-svg");
    // Should have <path> elements inside the SVG
    expect(html).toContain("<path");
  });

  it("contains a legend section with links to topic pages", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    expect(html).toContain("theme-river-legend");
    expect(html).toContain("river-legend-item");
    // Legend items link to topic detail pages
    expect(html).toContain('href="/topics/llms"');
    expect(html).toContain('href="/topics/agent"');
  });
});

describe("ThemeRiver on topics index", () => {
  it("contains theme-river-svg on /topics", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("theme-river-svg");
  });

  it("has path elements for each top topic", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    // 4 topics with usage >= 5: llms, agent, coding, vibe
    const pathMatches = html.match(/<path /g);
    expect(pathMatches).not.toBeNull();
    expect(pathMatches!.length).toBeGreaterThanOrEqual(4);
  });

  it("links each stream to the topic detail page", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    // The ThemeRiver paths are wrapped in <a> tags linking to topic pages
    expect(html).toContain('href="/topics/llms"');
    expect(html).toContain('href="/topics/agent"');
  });

  it("contains a legend section with links to topic pages", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();
    expect(html).toContain("theme-river-legend");
    expect(html).toContain("river-legend-item");
    // Legend items link to topic detail pages
    expect(html).toContain('href="/topics/llms"');
    expect(html).toContain('href="/topics/agent"');
  });
});

describe("Slopegraph on topic detail page", () => {
  it("shows slopegraph when topic spans multiple years", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("slopegraph-svg");
    expect(html).toContain("Rank over time");
  });

  it("shows year labels in the slopegraph", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).toContain("2024");
    expect(html).toContain("2025");
  });

  it("does not show slopegraph when topic has data in only 1 year", async () => {
    // Create a topic that only appears in one year
    await env.DB.batch([
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('oneyear', 'oneyear', 3)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 5)"),
      env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 5)"),
      env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 5)"),
      env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 5)"),
    ]);
    // Both episodes 1 and 2 are in 2024, so only 1 year
    const res = await SELF.fetch("http://localhost/topics/oneyear");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("slopegraph-svg");
  });
});
