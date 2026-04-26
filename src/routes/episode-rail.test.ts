import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedEpisodeRailData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('episode-rail-source', 'Episode Rail Source')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-01-08-rail', 'Bits and Bobs 1/8/24', '2024-01-08', 2024, 1, 8, 2, 'notes')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-02-15-rail', 'Bits and Bobs 2/15/24', '2024-02-15', 2024, 2, 15, 2, 'notes')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-03-20-rail', 'Bits and Bobs 3/20/24', '2024-03-20', 2024, 3, 20, 4, 'notes')"),

    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (1, 'prev-1', 'Platform durability', 'Why are platforms durable? https://a.example', 'Why are platforms durable? https://a.example', 0, '[\"https://a.example\"]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (1, 'prev-2', 'Security memory', 'Security stories linger.', 'Security stories linger.', 1, '[]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (2, 'mid-1', 'Agent warnings', 'Could agents fail? https://b.example', 'Could agents fail? https://b.example', 0, '[\"https://b.example\"]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (2, 'mid-2', 'Security followup', 'Security and agents keep colliding.', 'Security and agents keep colliding.', 1, '[]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (3, 'curr-1', 'Unexpected bridge', 'How do agents reshape platform strategy? https://c.example', 'How do agents reshape platform strategy? https://c.example', 0, '[\"https://c.example\"]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (3, 'curr-2', 'Novel delta', 'Why does orchestration feel different now? https://d.example https://e.example', 'Why does orchestration feel different now? https://d.example https://e.example', 1, '[\"https://d.example\",\"https://e.example\",\"/topics/agents\",\"#curr-1\",\"mailto:test@example.com\"]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (3, 'curr-3', 'Thread followup', 'What did we learn from the earlier security cycle?', 'What did we learn from the earlier security cycle?', 2, '[]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json) VALUES (3, 'curr-4', 'Link roundup', 'Agents roundup? https://f.example https://g.example https://h.example', 'Agents roundup? https://f.example https://g.example https://h.example', 3, '[\"https://f.example\",\"https://g.example\",\"https://h.example\"]')"),

    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('platform', 'platform', 6, 1.5)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('agents', 'agents', 5, 2.4)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('security', 'security', 6, 1.9)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('orchestration', 'orchestration', 5, 3.1)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('surprise', 'surprise', 5, 2.7)"),

    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 4)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 5)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 2)"),

    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 3)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 4)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (3, 5)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedEpisodeRailData();
});

describe("Episode detail rail insights", () => {
  it("renders the new insight panels in the right rail", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-03-20-rail");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("Unexpected Pairings");
    expect(html).toContain("Most Novel Chunks");
    expect(html).toContain("Since Last Episode");
    expect(html).toContain("Archive Contrast");
    expect(html).toContain("External Links");
    expect(html).toContain('class="topic-help-tip"');
    expect(html).toContain('class="rail-panel-heading-row"');
    expect(html).toContain('class="topic-tier-main rail-panel rail-panel-list"');
    expect(html).toContain('class="topic-stack"');
    expect(html).not.toContain("Generativity Sparkline");
    expect(html).not.toContain("Novelty Sparkline");
    expect(html).not.toContain("Reference Density Map");
    expect(html).not.toContain("Question Pressure");
    expect(html).not.toContain("Gone");
    expect(html).not.toContain("rail-topic-inline");
    expect(html).not.toContain("Biggest Callbacks");
    expect(html).not.toContain("Bridge Ideas");
    expect(html).not.toContain("Thread Continuations");
  });

  it("raises the pairing threshold so single-chunk pairings are suppressed", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-03-20-rail");
    const html = await res.text();
    const start = html.indexOf("Unexpected Pairings");
    const end = html.indexOf("Most Novel Chunks", start);
    const pairingsSection = html.slice(start, end);

    expect(pairingsSection).toContain("Unexpected Pairings");
    expect(pairingsSection).toContain('href="/topics/agents"');
    expect(pairingsSection).toContain('href="/topics/security"');
    expect(pairingsSection).not.toContain('href="/topics/platform"');
    expect(pairingsSection).not.toContain('href="/topics/orchestration"');
    expect(pairingsSection).toContain("earlier shared chunks");
  });

  it("describes archive comparison and lists external links", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-03-20-rail");
    const html = await res.text();

    expect(html).toContain('href="/episodes/2024-02-15-rail"');
    expect(html).toContain("Compared with");
    expect(html).toContain("New");
    expect(html).toContain("Up");
    expect(html).not.toContain("Gone");
    expect(html).toContain("× typical");
    expect(html).not.toContain('class="episode-insight-kicker"');
    expect(html).toContain('class="rail-item-title"');
    expect(html).toContain('href="https://c.example"');
    expect(html).toContain('href="https://f.example"');
    expect(html).not.toContain('from <a href="#curr-4">Link roundup</a>');
    expect(html).not.toContain('href="/topics/agents" target="_blank"');
    expect(html).not.toContain('href="#curr-1" target="_blank"');
    expect(html).not.toContain('href="mailto:test@example.com" target="_blank"');
    expect(html).toContain("Bits and Bobs 2/15/24");
  });
});
