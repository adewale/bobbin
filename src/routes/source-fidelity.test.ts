import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

const richBlocks = JSON.stringify([
  {
    type: "list_item",
    depth: 0,
    listStyle: "unordered",
    plainText: "Prompt injection attack matters.",
    nodes: [
      { type: "text", text: "Prompt injection attack", bold: true },
      { type: "text", text: " matters. " },
      { type: "text", text: "Read more", href: "https://example.com/article", underline: true },
    ],
  },
  {
    type: "list_item",
    depth: 1,
    listStyle: "unordered",
    plainText: "Nested note with superscript.",
    nodes: [
      { type: "text", text: "Nested note with " },
      { type: "text", text: "superscript", superscript: true },
      { type: "text", text: "." },
    ],
  },
  {
    type: "list_item",
    depth: 1,
    listStyle: "unordered",
    plainText: "Struck text and image.",
    nodes: [
      { type: "text", text: "Struck", strikethrough: true },
      { type: "text", text: " text and " },
      { type: "image", src: "https://example.com/image.png", alt: "Diagram" },
    ],
  },
  {
    type: "separator",
    depth: 0,
    listStyle: null,
    plainText: "",
    nodes: [],
  },
]);

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('doc', 'Doc')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format, rich_content_json, content_markdown, links_json) VALUES (1, '2025-01-06-doc', 'Bits and Bobs 1/6/25', '2025-01-06', 2025, 1, 6, 1, 'essays', ?, ?, ?)"
    ).bind(richBlocks, '- Prompt injection attack matters.', JSON.stringify([{ text: 'Read more', href: 'https://example.com/article' }])),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, rich_content_json, content_markdown, links_json, images_json) VALUES (1, 'prompt-injection-doc-0', 'Prompt injection attack matters.', 'Prompt injection attack matters.', 'Prompt injection attack matters.', 0, ?, ?, ?, ?)"
    ).bind(
      richBlocks,
      '- Prompt injection attack matters.',
      JSON.stringify([{ text: 'Read more', href: 'https://example.com/article' }]),
      JSON.stringify([{ src: 'https://example.com/image.png', alt: 'Diagram' }]),
    ),
  ]);
});

describe("source fidelity rendering", () => {
  it("renders rich chunk content with links, nesting, formatting, images, and separators", async () => {
    const res = await SELF.fetch("http://localhost/chunks/prompt-injection-doc-0");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain("<strong>Prompt injection attack</strong>");
    expect(html).toContain("<u><a href=\"https://example.com/article\">Read more</a></u>");
    expect(html).toContain("<sup>superscript</sup>");
    expect(html).toContain("<s>Struck</s>");
    expect(html).toContain('<ul class="rich-list rich-depth-0">');
    expect(html).toContain('<ul class="rich-list rich-depth-1">');
    expect(html).toContain('<figure class="rich-image-figure">');
    expect(html).toContain('src="https://example.com/image.png"');
    expect(html).toContain("rich-separator");
  });

  it("renders rich episode content with nested blocks", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2025-01-06-doc");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain('<ul class="rich-list rich-depth-1">');
    expect(html).toContain('src="https://example.com/image.png"');
  });
});
