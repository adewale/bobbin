import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedHomepageData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('doc1', 'Source 1')"),
    // Two episodes: the latest has topics and chunks
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2026-04-06-latest', 'Bits and Bobs 4/6/26', '2026-04-06', 2026, 4, 6, 3, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2026-03-30-older', 'Bits and Bobs 3/30/26', '2026-03-30', 2026, 3, 30, 1, 'notes')"
    ),
    // Chunks for latest episode
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'insightful-comment-2026-04-06', 'An insightful HackerNews comment about code generation', '<p>An insightful comment</p>', 'An insightful comment', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'mama-bird-2026-04-06', 'I feel like the mama bird feeding my little Claude Codes', '<p>Mama bird</p>', 'Mama bird feeding', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'llms-great-2026-04-06', 'LLMs are great at things that are expensive to generate', '<p>LLMs great</p>', 'LLMs are great', 2)"
    ),
    // Chunk for older episode
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'older-chunk-2026-03-30', 'Older chunk', '<p>Older</p>', 'Older chunk', 0)"
    ),
    // Topics
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 50)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('agent', 'agent', 30)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('chatgpt', 'chatgpt', 20)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('swarm', 'swarm', 15)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 10)"),
    // Link topics to latest episode
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 4)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 5)"),
    // Link topics to chunks
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedHomepageData();
});

describe("Homepage latest episode panel", () => {
  it("contains latest-episode-panel class", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("latest-episode-panel");
  });

  it("shows episode title and chunk titles in the latest panel", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    // Extract the latest-episode-panel section
    const panelStart = html.indexOf("latest-episode-panel");
    expect(panelStart).toBeGreaterThan(-1);
    const panelEnd = html.indexOf("</section>", panelStart);
    const panelHtml = html.substring(panelStart, panelEnd);
    expect(panelHtml).toContain("Bits and Bobs 4/6/26");
    expect(panelHtml).toContain("An insightful HackerNews comment about code generation");
    expect(panelHtml).toContain("I feel like the mama bird feeding my little Claude Codes");
    expect(panelHtml).toContain("LLMs are great at things that are expensive to generate");
    expect(panelHtml).toContain("See all");
  });

  it("has topic marginalia with links to /topics/:slug", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    // Extract the latest-episode-panel section
    const panelStart = html.indexOf("latest-episode-panel");
    expect(panelStart).toBeGreaterThan(-1);
    const panelEnd = html.indexOf("</section>", panelStart);
    const panelHtml = html.substring(panelStart, panelEnd);
    expect(panelHtml).toContain("latest-topics");
    expect(panelHtml).toContain('href="/topics/llms"');
    expect(panelHtml).toContain('href="/topics/agent"');
    expect(panelHtml).toContain('href="/topics/chatgpt"');
  });

  it("does not show display-suppressed topics in the latest panel", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO topics (name, slug, usage_count, display_suppressed, display_reason) VALUES ('hidden topic', 'hidden-topic', 99, 1, 'subsumed_by_phrase')"
      ),
      env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 6)"),
    ]);

    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    const panelStart = html.indexOf("latest-episode-panel");
    const panelEnd = html.indexOf("</section>", panelStart);
    const panelHtml = html.substring(panelStart, panelEnd);

    expect(panelHtml).not.toContain("hidden topic");
    expect(panelHtml).not.toContain('href="/topics/hidden-topic"');
  });
});

describe("Homepage margin layout", () => {
  it("has Recent Episodes and Popular Topics in the margin", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("page-with-rail");
    expect(html).toContain("page-with-rail--aligned");
    expect(html).toContain("page-rail");
    expect(html).toContain("home-margin");
    expect(html).toContain("page-preamble");
    expect(html).toContain("Recent Episodes");
  });

  it("uses header search as the homepage's primary search affordance", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('class="header-search"');
    expect(html).not.toContain('class="search-form"');
  });
});
