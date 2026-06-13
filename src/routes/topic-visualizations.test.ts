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

  it("anchors the right-edge date label with text-anchor=end when a topic spans >18 dates", async () => {
    // >18 distinct dates takes the two-landmark branch. The right-edge label
    // sits at x = w - bottomPad; middle-anchoring it overflows the SVG (caught
    // by the layout-grid e2e audit). It must be end-anchored.
    await applyTestMigrations(env.DB);
    const statements = [
      env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('wide', 'Wide')"),
      env.DB.prepare("INSERT INTO topics (id, name, slug, usage_count) VALUES (1, 'spanning', 'spanning', 20)"),
    ];
    const dates: string[] = [];
    for (let i = 0; i < 20; i++) {
      const month = String((i % 12) + 1).padStart(2, "0");
      const day = String((i % 27) + 1).padStart(2, "0");
      const year = 2024 + Math.floor(i / 12);
      const date = `${year}-${month}-${day}`;
      dates.push(date);
      const episodeId = i + 1;
      const chunkId = i + 1;
      statements.push(
        env.DB.prepare(
          "INSERT INTO episodes (id, source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 1, 'notes')"
        ).bind(episodeId, `${date}-ep`, `Episode ${episodeId}`, date, year, Number(month), Number(day)),
        env.DB.prepare(
          "INSERT INTO chunks (id, episode_id, slug, title, content, content_plain, position) VALUES (?, ?, ?, 'Spanning topic', '<p>x</p>', 'spanning topic content here', 0)"
        ).bind(chunkId, episodeId, `spanning-${chunkId}`),
        env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, 1)").bind(chunkId),
        env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (?, 1)").bind(episodeId),
      );
    }
    await env.DB.batch(statements);

    const res = await SELF.fetch("http://localhost/topics/spanning");
    expect(res.status).toBe(200);
    const html = await res.text();

    const lastDate = dates[dates.length - 1];
    const firstDate = dates[0];

    const lastLabel = html.match(new RegExp(`<text[^>]*>\\s*${lastDate}\\s*</text>`));
    expect(lastLabel, "right-edge landmark label should render").not.toBeNull();
    expect(lastLabel![0]).toContain('text-anchor="end"');
    expect(lastLabel![0]).not.toContain('text-anchor="middle"');

    const firstLabel = html.match(new RegExp(`<text[^>]*>\\s*${firstDate}\\s*</text>`));
    expect(firstLabel, "left-edge landmark label should render").not.toBeNull();
    expect(firstLabel![0]).toContain('text-anchor="start"');
  });
});

describe("Topic detail page — observation cards and help tips", () => {
  it("contains observation cards linked to chunk detail pages", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("topic-observation-card");
    expect(html).toContain('href="/chunks/chunk-llms-1"');
  });

  it("supports chronological observation sorting instead of a separate evolution list", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms?sort=oldest");
    const html = await res.text();
    expect(html).toContain("Oldest first");
    expect(html).not.toContain('data-topic-tab="evolution"');
    expect(html).not.toContain("evolution-timeline");
  });

  it("renders section help tips alongside topic detail blocks", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).toContain('class="topic-help-tip"');
    expect(html).toContain('aria-label="Explain observations"');
    expect(html).toContain('aria-label="Explain topic summary"');
  });

  it("no longer renders the in-context kwic block", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).not.toContain("kwic-row");
    expect(html).not.toContain('data-topic-tab="in-context"');
  });

  it("does not render the removed episodes overview affordances", async () => {
    const res = await SELF.fetch("http://localhost/topics/llms");
    const html = await res.text();
    expect(html).not.toContain('data-topic-tab="episodes"');
    expect(html).not.toContain("Inspect observations");
    expect(html).not.toContain('class="ep-density-spark"');
  });
});
