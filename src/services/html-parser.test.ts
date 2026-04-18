import { describe, it, expect } from "vitest";
import { parseHtmlDocument, extractDocLinksFromHtml } from "./html-parser";
import sampleHtml from "../../test/fixtures/sample-mobilebasic.html?raw";

describe("parseHtmlDocument", () => {
  const episodes = parseHtmlDocument(sampleHtml);

  it("extracts correct number of episodes", () => {
    expect(episodes).toHaveLength(3);
  });

  it("parses episode dates correctly", () => {
    expect(episodes[0].parsedDate.toISOString().split("T")[0]).toBe("2026-04-06");
    expect(episodes[1].parsedDate.toISOString().split("T")[0]).toBe("2026-03-30");
    expect(episodes[2].parsedDate.toISOString().split("T")[0]).toBe("2026-03-23");
  });

  it("generates episode titles from dates", () => {
    expect(episodes[0].title).toBe("Bits and Bobs 4/6/26");
  });

  it("extracts chunks from each episode", () => {
    // Episode 1: 3 level-0 chunks
    expect(episodes[0].chunks.length).toBe(3);
    // Episode 2: 2 level-0 chunks
    expect(episodes[1].chunks.length).toBe(2);
    // Episode 3: 1 chunk
    expect(episodes[2].chunks.length).toBe(1);
  });

  it("includes sub-points in chunk content", () => {
    // First chunk has the main text plus 2 sub-points
    const firstChunk = episodes[0].chunks[0];
    expect(firstChunk.contentPlain).toContain("software provider");
    expect(firstChunk.contentPlain).toContain("former");
    expect(firstChunk.contentPlain).toContain("latter");
  });

  it("preserves rich links with resolved hrefs", () => {
    const chunkWithLink = episodes.flatMap((ep) => ep.chunks).find((chunk) => chunk.links.length > 0);
    expect(chunkWithLink).toBeDefined();
    expect(chunkWithLink!.links[0].href.startsWith("http")).toBe(true);
    expect(chunkWithLink!.links[0].href).not.toContain("google.com/url?");
  });

  it("preserves rich formatting and nesting metadata", () => {
    const firstChunk = episodes[0].chunks[0];
    expect(firstChunk.richContent.length).toBeGreaterThan(0);
    expect(firstChunk.richContent[0].depth).toBe(0);
    expect(firstChunk.richContent.some((block) => block.depth > 0)).toBe(true);
  });

  it("derives markdown for chunks", () => {
    const firstChunk = episodes[0].chunks[0];
    expect(firstChunk.contentMarkdown.length).toBeGreaterThan(10);
    expect(firstChunk.contentMarkdown).toContain("- ");
  });

  it("generates meaningful titles from main chunk text", () => {
    const title = episodes[0].chunks[0].title;
    expect(title.length).toBeGreaterThan(5);
    // Full sentence titles — no arbitrary length cap
    expect(title.length).toBeGreaterThan(10);
    // Should NOT contain sub-point text
    expect(title).not.toContain("former");
  });

  it("sets chunk positions", () => {
    expect(episodes[0].chunks[0].position).toBe(0);
    expect(episodes[0].chunks[1].position).toBe(1);
    expect(episodes[0].chunks[2].position).toBe(2);
  });

  it("separates chunks correctly - second chunk is independent", () => {
    const secondChunk = episodes[0].chunks[1];
    expect(secondChunk.contentPlain).toContain("house that is on fire");
    expect(secondChunk.contentPlain).toContain("fundamentals");
    // Should NOT contain text from chunk 1
    expect(secondChunk.contentPlain).not.toContain("software provider");
  });
});

describe("extractDocLinksFromHtml", () => {
  it("extracts Google Doc IDs from links", () => {
    const links = extractDocLinksFromHtml(sampleHtml);
    expect(links).toContain("1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0");
  });
});
