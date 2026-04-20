import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('s1', 'Source')"),

    // Three episodes spread across time
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-04-08-ep', 'Episode 1', '2024-04-08', 2024, 4, 8, 2, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-05-01-ep', 'Episode 2', '2024-05-01', 2024, 5, 1, 1, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-06-01-ep', 'Episode 3', '2024-06-01', 2024, 6, 1, 1, 'notes')"
    ),

    // Four chunks — varying frequency of "llms" across episodes
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-llms-1', 'LLMs are transforming', '<p>LLMs</p>', 'The future of llms is agents that can orchestrate other models to accomplish complex tasks.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-llms-2', 'More LLM thoughts', '<p>More</p>', 'Applied naively llms just turn the crank on existing processes.', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'chunk-llms-3', 'LLMs and code', '<p>Code</p>', 'Fine-tuning llms on proprietary data is becoming standard practice.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'chunk-other', 'Non-LLM chunk', '<p>Other</p>', 'This chunk is about something entirely different with no relevant topic words.', 0)"
    ),

    // Topic: "llms" appears across episodes 1 and 2 (not 3)
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 3)"),

    // chunk_topics: llms on chunks 1, 2, 3 (not chunk 4)
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 1)"),

    // episode_topics
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 1)"),

    // word_stats for llms
    env.DB.prepare(
      "INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES ('llms', 1036, 710, 113.6, 0)"
    ),

    // chunk_words: llms appears in chunks 1, 2, 3 with varying counts
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (1, 'llms', 5)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (2, 'llms', 3)"),
    env.DB.prepare("INSERT INTO chunk_words (chunk_id, word, count) VALUES (3, 'llms', 2)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedData();
});

describe("Topic detail page — dispersion plot", () => {
  it("contains a dispersion-svg element", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("topic-spark-svg");
  });

  it("has rect elements for episodes where the topic appears", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    // The sparkline includes rug marks for 2 episodes where the topic appears.
    expect(html).toMatch(/<rect[^>]*class="dispersion-mark"/);
    const marks = html.match(/<rect[^>]*class="dispersion-mark"/g);
    expect(marks).not.toBeNull();
    expect(marks!.length).toBe(2);
  });
});

describe("Topic detail page — in-context rows", () => {
  it("contains expandable kwic-row elements", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("kwic-row");
  });

  it("shows the topic name centered between left and right context", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).toContain('class="kwic-left"');
    expect(html).toContain('class="kwic-word"');
    expect(html).toContain('class="kwic-right"');
  });

  it("links KWIC entries to chunk detail pages", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).toContain('href="/chunks/chunk-llms-1"');
  });
});
