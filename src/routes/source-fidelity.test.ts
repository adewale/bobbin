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
      { type: "text", text: " See note", href: "#cmnt470", superscript: true },
    ],
    anchorIds: ["id.anchor-1"],
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
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, rich_content_json, content_markdown, links_json, images_json, footnotes_json) VALUES (1, 'prompt-injection-doc-0', 'Prompt injection attack matters.', 'Prompt injection attack matters.', 'Prompt injection attack matters.', 0, ?, ?, ?, ?, ?)"
    ).bind(
      richBlocks,
      '- Prompt injection attack matters.',
      JSON.stringify([{ text: 'Read more', href: 'https://example.com/article' }, { text: '[rb]', href: '#cmnt470' }]),
      JSON.stringify([{ src: 'https://example.com/image.png', alt: 'Diagram' }]),
      JSON.stringify([{ id: 'cmnt470', label: 'rb', text: 'One total reaction' }]),
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
    expect(html).toContain('id="id.anchor-1"');
    expect(html).toContain('id="cmnt470"');
    expect(html).toContain('One total reaction');
  });

  it("renders rich episode content with nested blocks", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2025-01-06-doc");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain('<ul class="rich-list rich-depth-1">');
    expect(html).toContain('src="https://example.com/image.png"');
  });

  it("never renders executable URL schemes from stored rich content", async () => {
    // Rows stored before ingest-side scheme sanitization existed may carry a
    // hostile href; rendering is the last line of defense.
    const hostileBlocks = JSON.stringify([
      {
        type: "paragraph",
        depth: 0,
        listStyle: "paragraph",
        plainText: "Click me and a safe link.",
        nodes: [
          { type: "text", text: "Click me", href: "javascript:alert(document.cookie)" },
          { type: "text", text: " and " },
          { type: "text", text: "a safe link", href: "https://example.com/safe" },
          { type: "image", src: "data:text/html,<script>alert(1)</script>", alt: "bad image" },
        ],
      },
    ]);
    await env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, rich_content_json) VALUES (1, 'hostile-doc-1', 'Hostile', 'Hostile', 'Hostile', 1, ?)"
    ).bind(hostileBlocks).run();

    const res = await SELF.fetch("http://localhost/chunks/hostile-doc-1");
    const html = await res.text();

    expect(res.status).toBe(200);
    // Rejection: no executable scheme reaches the page
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain('href="#"');
    // Preservation: the safe link survives untouched
    expect(html).toContain('href="https://example.com/safe"');
  });
});
