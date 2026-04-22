import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ChunkRow } from "../types";
import { collectExternalLinks } from "./episode-rail";

describe("collectExternalLinks", () => {
  it("keeps only external http-style links for arbitrary mixed link payloads", () => {
    const externalArb = fc.oneof(
      fc.webUrl({ validSchemes: ["http", "https"] }),
      fc.domain().map((domain) => `www.${domain}`),
    );
    const internalArb = fc.oneof(
      fc.stringMatching(/^\/[a-z0-9/-]{1,20}$/),
      fc.stringMatching(/^#[a-z0-9-]{1,20}$/),
      fc.emailAddress().map((value) => `mailto:${value}`),
      fc.constantFrom("javascript:alert(1)", "tel:+1234567", "ftp://example.com/file"),
    );

    fc.assert(
      fc.property(
        fc.array(fc.oneof(externalArb, internalArb), { minLength: 1, maxLength: 12 }),
        (hrefs) => {
          const chunk = buildChunk({ links_json: JSON.stringify(hrefs) });
          const links = collectExternalLinks([chunk]);

          for (const link of links) {
            expect(link.href).toMatch(/^(https?:\/\/|www\.)/i);
            expect(link.href).not.toMatch(/^(\/|#|mailto:|javascript:|tel:|ftp:)/i);
          }

          const expected = [...new Set(hrefs.filter((href) => /^(https?:\/\/|www\.)/i.test(href)))];
          expect(links.map((link) => link.href)).toEqual(expected);
        },
      ),
    );
  });
});

function buildChunk(overrides: Partial<ChunkRow>): ChunkRow {
  return {
    id: 1,
    episode_id: 1,
    slug: "chunk-1",
    title: "Chunk 1",
    content: "",
    content_plain: "",
    summary: null,
    position: 0,
    word_count: 0,
    vector_id: null,
    content_markdown: null,
    rich_content_json: null,
    links_json: null,
    images_json: null,
    footnotes_json: null,
    analysis_text: null,
    normalization_version: 1,
    normalization_warnings: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}
