/**
 * Golden file tests for the HTML parser.
 * Uses Vitest's inline snapshot/toMatchSnapshot to verify parse outputs
 * remain stable across changes. If the parser output changes intentionally,
 * update snapshots with `npx vitest run -u`.
 */
import { describe, it, expect } from "vitest";
import { parseHtmlDocument, extractDocLinksFromHtml } from "./html-parser";
import sampleEssays from "../../test/fixtures/sample-mobilebasic.html?raw";
import sampleNotes from "../../test/fixtures/sample-notes-format.html?raw";

function summarizeParseResult(html: string) {
  const episodes = parseHtmlDocument(html);
  return episodes.map((ep) => ({
    title: ep.title,
    format: ep.format,
    dateStr: ep.dateStr,
    chunkCount: ep.chunks.length,
    chunkTitles: ep.chunks.map((c) => c.title),
    chunkPositions: ep.chunks.map((c) => c.position),
  }));
}

describe("HTML parser golden file: essays format", () => {
  const result = summarizeParseResult(sampleEssays);

  it("produces stable episode structure", () => {
    expect(result.length).toBe(3);
    expect(result[0].title).toBe("Bits and Bobs 4/6/26");
    expect(result[1].title).toBe("Bits and Bobs 3/30/26");
    expect(result[2].title).toBe("Bits and Bobs 3/23/26");
  });

  it("produces stable chunk counts per episode", () => {
    expect(result[0].chunkCount).toBe(3);
    expect(result[1].chunkCount).toBe(2);
    expect(result[2].chunkCount).toBe(1);
  });

  it("produces stable format detection", () => {
    for (const ep of result) {
      expect(ep.format).toBe("essays");
    }
  });

  it("produces stable chunk positions (sequential from 0)", () => {
    expect(result[0].chunkPositions).toEqual([0, 1, 2]);
    expect(result[1].chunkPositions).toEqual([0, 1]);
    expect(result[2].chunkPositions).toEqual([0]);
  });

  it("chunk titles are non-empty and deterministic", () => {
    for (const ep of result) {
      for (const title of ep.chunkTitles) {
        expect(title.length).toBeGreaterThan(5);
        // Titles should be real sentences, not placeholders
        expect(title).not.toMatch(/^chunk-\d+$/);
      }
    }
  });

  it("full parse snapshot is stable", () => {
    expect(result).toMatchSnapshot();
  });
});

describe("HTML parser golden file: notes format", () => {
  const result = summarizeParseResult(sampleNotes);

  it("produces stable episode structure", () => {
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Bits and Bobs 5/1/26");
  });

  it("produces correct chunk count for notes format", () => {
    // Notes format: many short chunks
    expect(result[0].chunkCount).toBeGreaterThan(10);
  });

  it("detects notes format correctly", () => {
    expect(result[0].format).toBe("notes");
  });

  it("chunk positions are sequential", () => {
    const positions = result[0].chunkPositions;
    for (let i = 0; i < positions.length; i++) {
      expect(positions[i]).toBe(i);
    }
  });

  it("full parse snapshot is stable", () => {
    expect(result).toMatchSnapshot();
  });
});

describe("HTML parser golden: content fidelity", () => {
  it("essay chunks preserve sub-point text in content", () => {
    const episodes = parseHtmlDocument(sampleEssays);
    const firstChunk = episodes[0].chunks[0];

    // Main observation
    expect(firstChunk.contentPlain).toContain("software provider");
    // Sub-points should be in the full content
    expect(firstChunk.contentPlain).toContain("former");
    expect(firstChunk.contentPlain).toContain("latter");
  });

  it("notes format chunks are standalone observations", () => {
    const episodes = parseHtmlDocument(sampleNotes);
    const chunks = episodes[0].chunks;

    // Each chunk should contain its own observation
    for (const chunk of chunks) {
      expect(chunk.contentPlain.length).toBeGreaterThan(5);
      // Standalone chunks should not bleed into each other
      expect(chunk.contentPlain.split("\n").length).toBeLessThanOrEqual(3);
    }
  });

  it("doc links are extracted consistently", () => {
    const links = extractDocLinksFromHtml(sampleEssays);
    expect(links).toContain("1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0");
    expect(links.length).toBe(1);

    // Notes format has no doc links
    const notesLinks = extractDocLinksFromHtml(sampleNotes);
    expect(notesLinks.length).toBe(0);
  });
});
