import { describe, it, expect } from "vitest";
import { parseDocument, extractDocLinks } from "./doc-parser";
import sampleDoc from "../../test/fixtures/sample-doc.json";

describe("parseDocument", () => {
  const episodes = parseDocument(sampleDoc as any);

  it("extracts correct number of episodes", () => {
    expect(episodes).toHaveLength(2);
  });

  it("parses episode dates correctly", () => {
    expect(episodes[0].parsedDate.toISOString().split("T")[0]).toBe("2024-04-08");
    expect(episodes[1].parsedDate.toISOString().split("T")[0]).toBe("2024-03-25");
  });

  it("generates episode titles from dates", () => {
    expect(episodes[0].title).toBe("Bits and Bobs 4/8/24");
    expect(episodes[1].title).toBe("Bits and Bobs 3/25/24");
  });

  it("preserves heading IDs", () => {
    expect(episodes[0].headingId).toBe("h.episode1");
    expect(episodes[1].headingId).toBe("h.episode2");
  });

  it("extracts correct number of chunks per episode", () => {
    expect(episodes[0].chunks).toHaveLength(2);
    expect(episodes[1].chunks).toHaveLength(1);
  });

  it("extracts chunk titles", () => {
    expect(episodes[0].chunks[0].title).toBe("Nanotech cages for circus bears");
    expect(episodes[0].chunks[1].title).toBe("Frankenstein ecosystems");
    expect(episodes[1].chunks[0].title).toBe("Whale falls");
  });

  it("extracts chunk content with multiple paragraphs", () => {
    const chunk = episodes[0].chunks[0];
    expect(chunk.content).toContain("contain powerful AI systems");
    expect(chunk.content).toContain("second paragraph");
  });

  it("sets chunk positions", () => {
    expect(episodes[0].chunks[0].position).toBe(0);
    expect(episodes[0].chunks[1].position).toBe(1);
  });

  it("generates plain text from content", () => {
    const chunk = episodes[1].chunks[0];
    expect(chunk.contentPlain).toContain("whale fall");
    expect(chunk.contentPlain).toContain("See also the archive doc for older editions.");
  });
});

describe("extractDocLinks", () => {
  it("extracts Google Doc IDs from document links", () => {
    const links = extractDocLinks(sampleDoc as any);
    expect(links).toContain("1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0");
  });

  it("does not include the document's own ID", () => {
    const links = extractDocLinks(sampleDoc as any);
    expect(links).not.toContain("test-doc-id");
  });
});
