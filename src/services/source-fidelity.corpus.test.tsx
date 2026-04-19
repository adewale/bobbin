import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "hono/jsx/dom/server";
import { RichContent } from "../components/RichContent";
import { decodeHtmlEntities } from "../lib/html";
import { parseHtmlDocument } from "./html-parser";

function semanticTokens(text: string, stripTags: boolean): string[] {
  const cleaned = decodeHtmlEntities((stripTags ? text.replace(/<[^>]+>/g, " ") : text))
    .replace(/\[Image(?:: [^\]]+)?\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\[(.*?)\]/g, (_match, inner) => `[${String(inner).replace(/:\s+/g, ":").trim()}]`)
    .trim();

  return cleaned.match(/\[[^\]]+\]|[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?|→|[.,;:!?()"“”‘’-]+/g) || [];
}

function semanticProjection(text: string, stripTags: boolean): string {
  return semanticTokens(text, stripTags).join("").replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
}

const DOCS = [
  "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html",
  "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw.html",
  "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA.html",
];

const hasLocalData = existsSync(join(process.cwd(), "data/raw", DOCS[0]));

describe.skipIf(!hasLocalData)("source fidelity corpus rendering", () => {
  it("renders every richly formatted chunk into semantically correct HTML", () => {
    let chunksWithLinks = 0;
    let chunksWithSuperscript = 0;
    let chunksWithStrikethrough = 0;
    let chunksWithImages = 0;
    let chunksWithSeparators = 0;
    let chunksWithNestedLists = 0;

    for (const doc of DOCS) {
      const html = readFileSync(join(process.cwd(), "data/raw", doc), "utf8");
      const episodes = parseHtmlDocument(html);
      for (const episode of episodes) {
        for (const chunk of episode.chunks) {
          const blocks = chunk.richContent;
          const hasLinks = chunk.links.length > 0;
          const hasSuperscript = blocks.some((block) => block.nodes.some((node) => node.superscript));
          const hasStrikethrough = blocks.some((block) => block.nodes.some((node) => node.strikethrough));
          const hasImages = chunk.images.length > 0;
          const hasSeparators = blocks.some((block) => block.type === "separator");
          const hasNested = blocks.some((block) => block.depth > 0);

          if (!(hasLinks || hasSuperscript || hasStrikethrough || hasImages || hasSeparators || hasNested)) continue;

          const rendered = renderToString(<RichContent blocks={blocks} />);
          const renderedProjection = semanticProjection(rendered, true);
          const expectedProjection = semanticProjection(blocks.filter((block) => block.plainText).map((block) => block.plainText).join(" "), false);

          expect(renderedProjection).toBe(expectedProjection);

          if (hasLinks) {
            chunksWithLinks += 1;
            expect(rendered).toContain("<a href=");
          }
          if (hasSuperscript) {
            chunksWithSuperscript += 1;
            expect(rendered).toContain("<sup>");
          }
          if (hasStrikethrough) {
            chunksWithStrikethrough += 1;
            expect(rendered).toContain("<s>");
          }
          if (hasImages) {
            chunksWithImages += 1;
            expect(rendered).toContain("<figure class=\"rich-image-figure\">");
            expect(rendered).toContain("<img ");
          }
          if (hasSeparators) {
            chunksWithSeparators += 1;
            expect(rendered).toContain("rich-separator");
          }
          if (hasNested) {
            chunksWithNestedLists += 1;
            expect(rendered).toContain("rich-depth-1");
            expect(rendered).toContain("<ul class=\"rich-list");
          }
        }
      }
    }

    expect(chunksWithLinks).toBeGreaterThan(0);
    expect(chunksWithSuperscript).toBeGreaterThan(0);
    expect(chunksWithImages).toBeGreaterThan(0);
    expect(chunksWithNestedLists).toBeGreaterThan(0);
  });
});
