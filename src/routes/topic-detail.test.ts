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
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-01-15-ep', 'Episode 3', '2025-01-15', 2025, 1, 15, 2, 'notes')"
    ),

    // Four chunks — topic language changes over time and shares context with related topics.
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-llms', 'LLMs are transforming', '<p>LLMs content</p>', 'The future of llms is agents that can orchestrate other models to accomplish complex tasks.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-agents', 'Agents overview', '<p>Agents</p>', 'Agents and llms work together in swarm architectures.', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-claude', 'Claude Code thoughts', '<p>Claude Code</p>', 'Claude code is an interesting product built on llms.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'chunk-security', 'Security and LLMs', '<p>Security</p>', 'Security teams now use llms for agent workflows, eval harnesses, and prompt defense.', 1)"
    ),

    // Topics: add one higher-ranked neighbor so adjacent-topic comparison has both sides.
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('security', 'security', 5)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 4)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('agents', 'agents', 2)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('claude code', 'claude-code', 1)"),

    // chunk_topics: llms on all 4 chunks, agents on chunk 1+2+4, security on chunk 4, claude code on chunk 3.
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 4)"),

    // episode_topics
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 4)"),

    // word_stats: entry for "llms" (single word) — none for "claude code"
    env.DB.prepare(
      "INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES ('llms', 1036, 710, 113.6, 0)"
    ),
    env.DB.prepare(
      "INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES ('agents', 200, 90, 25.3, 0)"
    ),
    env.DB.prepare(
      "INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES ('security', 320, 150, 11.8, 0)"
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
    expect(html).toContain('class="topic-stats-row"');
    expect(html).toContain("113.6");
    expect(html).toContain("distinctiveness vs baseline");
    expect(html).not.toContain("everyday baseline English");
    expect(html).not.toContain("highly distinctive");
  });

  it("shows related topics from co-occurrence", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    // Live-style related topics live in the header as an inline list.
    expect(html).toContain("Related:");
    expect(html).toContain('href="/topics/agents"');
    expect(html).toContain('href="/topics/claude-code"');
    expect(html).not.toContain("topic-related-panel");
  });

  it("adds the expanded tabbed affordance and the main sensemaking sections", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();

    expect(html).toContain('class="topic-summary body-panel"');
    expect(html).toContain("topic-tabs");
    expect(html).toContain('class="topic-tab-link is-active"');
    expect(html).toContain('data-topic-tab="observations"');
    expect(html).toContain('data-topic-tab="drift"');
    expect(html).toContain('href="#observations"');
    expect(html).toContain('href="#drift"');
    expect(html).toContain('id="over-time"');
    expect(html).toContain('id="observations"');
    expect(html).toContain('id="drift"');
    expect(html).not.toContain('data-topic-tab="episodes"');
    expect(html).not.toContain('data-topic-tab="in-context"');
    expect(html).not.toContain('data-topic-tab="evolution"');
    expect(html).not.toContain("page-toc");
  });

  it("renders right-rail analysis for rank, co-occurrence, and adjacent topics", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();

    expect(html).toContain("Rank over time");
    expect(html).toContain("topic-rank-panel");
    expect(html).toContain("rail-panel-heading-row");
    expect(html).not.toContain("topic-rail-heading-row");
    expect(html).toContain("Adjacent topics");
    expect(html).toContain('href="/topics/security"');
    expect(html).toContain('href="/topics/agents"');
    expect(html).not.toContain("Co-occurrence map");
  });

  it("adds explanatory tooltips for topic page blocks", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();

    expect(html).toContain('class="topic-help-tip"');
    expect(html).toContain('aria-label="Explain topic summary"');
    expect(html).toContain('aria-label="Explain observations"');
    expect(html).toContain('aria-label="Explain rank over time"');
    expect(html).toContain("Raw mentions over time. Use this to see absolute attention, not relative rank among all topics.");
    expect(html).not.toContain('aria-label="Explain episodes"');
  });

  it("adds a compact top-chart meta row and a contrastive summary line", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();

    expect(html).toContain('class="topic-sparkline-meta"');
    expect(html).toContain("Range");
    expect(html).toContain("Mean");
    expect(html).toContain("Peak");
    expect(html).toContain("Semantically it travels with");
    expect(html).toContain("while by chunk count it sits between");
  });

  it("removes the episodes panel and related drill-in affordances", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();

    expect(html).not.toContain('class="topic-tab-panel topic-episode-panel"');
    expect(html).not.toContain('data-topic-tab-panel="episodes"');
    expect(html).not.toContain("<h2>Episodes");
    expect(html).not.toContain('class="ep-density-spark"');
    expect(html).not.toContain('Inspect observations');
  });

  it("restores observations with highlighted excerpts and a terminology drift view", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();

    expect(html).toContain('class="topic-tab-panel topic-observations"');
    expect(html).toContain("Observations");
    expect(html).toContain('class="topic-observation-controls"');
    expect(html).toContain('data-topic-observation-nav="sort"');
    expect(html).toContain('data-topic-observation-sort="newest"');
    expect(html).toContain('data-topic-observation-sort="oldest"');
    expect(html).toContain("Newest first");
    expect(html).toContain("Oldest first");
    expect(html).toContain("<mark>llms</mark>");
    expect(html).toContain("Earlier framing");
    expect(html).toContain("Later framing");
    expect(html).not.toContain("Earlier focus");
    expect(html).not.toContain("Later focus");
  });

  it("sorts observations chronologically when requested", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms?sort=oldest");
    const html = await res.text();

    const observationsStart = html.indexOf('class="topic-observation-list"');
    const observationsEnd = html.indexOf('</div>', observationsStart);
    const observationsSection = html.substring(observationsStart, observationsEnd);

    expect(observationsSection.indexOf('href="/chunks/chunk-llms"')).toBeLessThan(observationsSection.indexOf('href="/chunks/chunk-agents"'));
    expect(observationsSection.indexOf('href="/chunks/chunk-agents"')).toBeLessThan(observationsSection.indexOf('href="/chunks/chunk-claude"'));
  });

  it("removes the in-context tab and kwic markup", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).not.toContain('data-topic-tab="in-context"');
    expect(html).not.toContain("kwic-list");
    expect(html).not.toContain("kwic-row");
  });

  it("works when word_stats has no entry for a multi-word topic", async () => {
    const res = await SELF.fetch("http://localhost/topics/claude-code");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should still show chunk and episode counts without mention count / distinctiveness
    expect(html).toContain("claude code");
    expect(html).not.toContain('class="topic-mentions"');
    expect(html).not.toContain('aria-label="Explain distinctiveness"');
    expect(html).not.toContain("distinctiveness vs baseline");
  });

  it("falls back to a solo topic layout when no rail panels are available", async () => {
    await applyTestMigrations(env.DB);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('solo-source', 'Solo Source')"),
      env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('orphan topic', 'orphan-topic', 0)"),
    ]);

    const res = await SELF.fetch("http://localhost/topics/orphan-topic");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("topic-detail-layout--solo");
    expect(html).not.toContain('page-with-rail page-with-rail--aligned topic-detail-layout');
    expect(html).not.toContain("topic-page-rail");
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
