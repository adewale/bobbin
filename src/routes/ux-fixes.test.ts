import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    // 2 episodes
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-04-08', 'Bits and Bobs 4/8/24', '2024-04-08', 2024, 4, 8, 3)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-03-25', 'Bits and Bobs 3/25/24', '2024-03-25', 2024, 3, 25, 2)"),
    // Chunks with topics that cross episodes
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-growth', 'Ecosystems grow organically', 'Ecosystems grow organically through local interactions.', 'Ecosystems grow organically through local interactions.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'platform-lock', 'Platform lock-in creates moats', 'Platform lock-in creates defensible moats for incumbents.', 'Platform lock-in creates defensible moats for incumbents.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'llm-slop', 'LLM slop detection is critical', 'Detecting AI-generated slop requires new quality signals.', 'Detecting AI-generated slop requires new quality signals.', 2)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'eco-collapse', 'Ecosystem collapse follows power laws', 'When ecosystems collapse the decline follows power law distributions.', 'When ecosystems collapse the decline follows power law distributions.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'platform-evolve', 'Platforms evolve through competition', 'Platform markets evolve through competitive ecosystem dynamics.', 'Platform markets evolve through competitive ecosystem dynamics.', 1)"),
    // Topics
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 3)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('platform', 'platform', 3)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 1)"),
    // Chunk-topic associations (ecosystem spans both episodes)
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 1)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedData();
});

// Fix 1: Episode page shows scannable TOC, not full content wall
describe("Fix 1: Episode page as TOC", () => {
  it("shows chunk titles as a scannable list", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08");
    const html = await res.text();
    expect(html).toContain("episode-chunks");
  });

  it("each TOC entry links to the chunk", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08");
    const html = await res.text();
    expect(html).toContain("/chunks/eco-growth");
    expect(html).toContain("/chunks/platform-lock");
    expect(html).toContain("/chunks/llm-slop");
  });
});

// Fix 3: Homepage surfaces most-connected content
describe("Fix 3: Most connected chunks on homepage", () => {
  it("homepage shows a 'most connected' section", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    expect(html).toContain("most-connected");
  });

  it("most-connected shows chunks with the highest topic overlap", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    // eco-growth and platform-evolve share the 'ecosystem' topic and span episodes
    // They should appear as connected content
    expect(html).toContain("Ecosystems grow");
  });
});

// Fix 5: Thread following on chunk page
describe("Fix 5: Thread following across episodes", () => {
  it("chunk page shows 'more on this topic' from other episodes", async () => {
    const res = await SELF.fetch("http://localhost/chunks/eco-growth");
    const html = await res.text();
    expect(html).toContain("more-on-this");
  });

  it("thread shows chunks from OTHER episodes sharing topics", async () => {
    const res = await SELF.fetch("http://localhost/chunks/eco-growth");
    const html = await res.text();
    // eco-growth (ep 2024-04-08) shares 'ecosystem' topic with eco-collapse (ep 2024-03-25)
    expect(html).toContain("eco-collapse");
    expect(html).toContain("Ecosystem collapse");
  });

  it("thread does not include chunks from the SAME episode", async () => {
    const res = await SELF.fetch("http://localhost/chunks/eco-growth");
    const html = await res.text();
    // Extract just the more-on-this <ul> content
    const moreMatch = html.match(/more-on-this[\s\S]*?<ul>([\s\S]*?)<\/ul>/);
    const moreList = moreMatch ? moreMatch[1] : "";
    // platform-lock is in the same episode — should not appear in thread list
    expect(moreList).not.toContain("platform-lock");
  });
});
