import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

const richBlocks = JSON.stringify([
  {
    type: "paragraph",
    depth: 0,
    listStyle: "paragraph",
    plainText: "Design systems should stay editorial.",
    nodes: [
      { type: "text", text: "Design systems", bold: true },
      { type: "text", text: " should stay editorial. " },
      { type: "text", text: "Reference", href: "https://example.com/reference", underline: true },
    ],
    anchorIds: ["id.design"],
  },
  {
    type: "list_item",
    depth: 0,
    listStyle: "unordered",
    plainText: "Reuse existing browse rows.",
    nodes: [{ type: "text", text: "Reuse existing browse rows." }],
  },
]);

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('design-doc', 'Design Doc')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, summary, chunk_count, format) VALUES (1, '2024-03-18-design', 'Bits and Bobs 3/18/24', '2024-03-18', 2024, 3, 18, 'March episode', 1, 'essays')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, summary, chunk_count, format) VALUES (1, '2024-02-12-design', 'Bits and Bobs 2/12/24', '2024-02-12', 2024, 2, 12, 'February episode', 1, 'essays')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, summary, chunk_count, format) VALUES (1, '2024-01-15-design', 'Bits and Bobs 1/15/24', '2024-01-15', 2024, 1, 15, 'January episode', 1, 'essays')"),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, content_markdown, rich_content_json, footnotes_json) VALUES (1, 'design-systems-2024-03-18', 'Design systems stay editorial', 'Design systems stay editorial.', 'Design systems stay editorial.', 0, ?, ?, ?)"
    ).bind(
      "Design systems stay editorial.",
      richBlocks,
      JSON.stringify([{ id: 'fn-design', label: '1', text: 'Editorial here means calm, readable, and structural.' }]),
    ),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'browse-rows-2024-02-12', 'Browse rows over dashboards', 'Browse rows over dashboards.', 'Browse rows over dashboards.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (3, 'search-cards-2024-01-15', 'Chunk cards need context', 'Chunk cards need context.', 'Chunk cards need context.', 0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('design systems', 'design-systems', 4)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('browse rows', 'browse-rows', 3)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('chunk cards', 'chunk-cards', 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 3)"),
  ]);
});

describe("GET /design", () => {
  it("renders the system inventory from shared components", async () => {
    const res = await SELF.fetch("http://localhost/design");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("Design | Bobbin");
    expect(html).toContain("The system inventory for Bobbin");
    expect(html).toContain("Component catalogue");
    expect(html).toContain('class="component-catalogue"');
    expect(html).toContain('class="breadcrumbs"');
    expect(html).toContain('class="search-form"');
    expect(html).toContain('class="episode-card"');
    expect(html).toContain('class="chunk-card"');
    expect(html).toContain('class="browse-year"');
    expect(html).toContain('class="topic-cloud"');
    expect(html).toContain('class="topic-stats-row"');
    expect(html).toContain('class="rich-content"');
    expect(html).toContain('class="rich-footnotes"');
    expect(html).toContain('class="pagination"');
    expect(html).toContain("empty-archive-state");
    expect(html).toContain('page-toc');
    expect(html).toContain('/chunks/design-systems-2024-03-18');
    expect(html).toContain('/topics/design-systems');
  });
});
