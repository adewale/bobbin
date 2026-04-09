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

  it("extracts chunks (observations) from each episode", () => {
    // Episode 1 has 3 observations separated by padding-top:12pt
    expect(episodes[0].chunks.length).toBe(3);
    // Episode 2 has 2 observations
    expect(episodes[1].chunks.length).toBe(2);
    // Episode 3 has 1 observation
    expect(episodes[2].chunks.length).toBe(1);
  });

  it("extracts chunk content as plain text", () => {
    const firstChunk = episodes[0].chunks[0];
    expect(firstChunk.contentPlain).toContain("software provider");
    expect(firstChunk.contentPlain).toContain("accomplishes");
  });

  it("generates chunk titles from first sentence", () => {
    const firstChunk = episodes[0].chunks[0];
    // Title should be derived from the first sentence/line
    expect(firstChunk.title.length).toBeGreaterThan(5);
    expect(firstChunk.title.length).toBeLessThanOrEqual(80);
  });

  it("sets chunk positions", () => {
    expect(episodes[0].chunks[0].position).toBe(0);
    expect(episodes[0].chunks[1].position).toBe(1);
    expect(episodes[0].chunks[2].position).toBe(2);
  });

  it("includes multi-line content in chunks", () => {
    // First chunk of episode 1 has the "selling software" observation
    // which spans multiple list items
    const chunk = episodes[0].chunks[0];
    expect(chunk.contentPlain).toContain("former");
    expect(chunk.contentPlain).toContain("latter");
  });
});

describe("extractDocLinksFromHtml", () => {
  it("extracts Google Doc IDs from links", () => {
    const links = extractDocLinksFromHtml(sampleHtml);
    expect(links).toContain("1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0");
  });
});
