import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedRichData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    // 3 episodes spread across months
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-01-15', 'Bits and Bobs 1/15/24', '2024-01-15', 2024, 1, 15, 2, 'essays')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-02-12', 'Bits and Bobs 2/12/24', '2024-02-12', 2024, 2, 12, 2, 'essays')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-03-18', 'Bits and Bobs 3/18/24', '2024-03-18', 2024, 3, 18, 1, 'essays')"),
    // Chunks with varying word usage
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-jan-0', 'Ecosystem dynamics', 'Ecosystem dynamics are complex.', 'Ecosystem dynamics are complex.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'plat-jan-1', 'Platform markets', 'Platform markets evolve.', 'Platform markets evolve.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'eco-feb-0', 'More ecosystems', 'Ecosystem health depends on ecosystem diversity.', 'Ecosystem health depends on ecosystem diversity.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'llm-feb-1', 'LLM thoughts', 'LLMs transform software creation.', 'LLMs transform software creation.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'eco-mar-0', 'Ecosystem collapse', 'When ecosystem collapse occurs, platforms adapt.', 'When ecosystem collapse occurs, platforms adapt.', 0)"),
    // Topics
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 3)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('platform', 'platform', 2)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 1)"),
    // Chunk-topic associations
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
    // Episode-topic associations
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 2)"),
    // Word stats word counts per chunk
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'ecosystem', 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (3, 'ecosystem', 2)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (5, 'ecosystem', 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'platform', 1)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (5, 'platform', 1)"),
    // Word stats aggregates
    env.DB.prepare("INSERT INTO word_stats (word, total_count, doc_count) VALUES ('ecosystem', 4, 3)"),
    env.DB.prepare("INSERT INTO word_stats (word, total_count, doc_count) VALUES ('platform', 2, 2)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedRichData();
});

// Feature 1 (word usage timeline) removed: /word-stats route was deleted as dead code.

// === Feature 2: Related chunks in the shared side rail ===
describe("Margin annotations on /chunks/:slug", () => {
  it("renders related chunks in the side rail", async () => {
    const res = await SELF.fetch("http://localhost/chunks/eco-jan-0");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("related-inline-list");
    expect(html).toContain("page-rail");
  });

  it("includes the chunk-detail-tufte layout class", async () => {
    const res = await SELF.fetch("http://localhost/chunks/eco-jan-0");
    const html = await res.text();
    expect(html).toContain("tufte-layout");
  });
});

// === Feature 3: Ladder of abstraction for topic browsing ===
describe("Ladder of abstraction on /topics/:slug", () => {
  it("shows corpus-level sparkline", async () => {
    const res = await SELF.fetch("http://localhost/topics/ecosystem");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("topic-sparkline");
    expect(html).toContain('id="over-time"');
  });

  it("does not show the removed episodes overview panel", async () => {
    const res = await SELF.fetch("http://localhost/topics/ecosystem");
    const html = await res.text();
    expect(html).not.toContain("topic-episode-panel");
    expect(html).not.toContain('id="episodes"');
  });

  it("shows chunk-level list", async () => {
    const res = await SELF.fetch("http://localhost/topics/ecosystem");
    const html = await res.text();
    expect(html).toContain("topic-observations");
    expect(html).toContain("Ecosystem dynamics");
    expect(html).toContain("More ecosystems");
    expect(html).toContain("Ecosystem collapse");
  });

  it("uses observation sorting instead of a separate evolution section", async () => {
    const res = await SELF.fetch("http://localhost/topics/ecosystem");
    const html = await res.text();
    expect(html).toContain("Oldest first");
    expect(html).not.toContain("topic-evolution");
    expect(html).not.toContain('id="evolution"');
  });
});
