import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import fc from "fast-check";
import { parseHtmlDocument } from "./html-parser";
import sampleEssays from "../../test/fixtures/sample-mobilebasic.html?raw";
import sampleNotes from "../../test/fixtures/sample-notes-format.html?raw";

describe("format detection", () => {
  it("essay-format fixture detected as essays", () => {
    const episodes = parseHtmlDocument(sampleEssays);
    for (const ep of episodes) {
      expect(ep.format).toBe("essays");
    }
  });

  it("notes-format fixture detected as notes", () => {
    const episodes = parseHtmlDocument(sampleNotes);
    for (const ep of episodes) {
      expect(ep.format).toBe("notes");
    }
  });

  it("essays format implies <= 12 chunks", () => {
    const allEpisodes = [
      ...parseHtmlDocument(sampleEssays),
      ...parseHtmlDocument(sampleNotes),
    ];
    for (const ep of allEpisodes) {
      if (ep.format === "essays") {
        expect(ep.chunks.length).toBeLessThanOrEqual(12);
      }
    }
  });

  it("notes format implies > 12 chunks OR low sub-point ratio", () => {
    const episodes = parseHtmlDocument(sampleNotes);
    for (const ep of episodes) {
      if (ep.format === "notes") {
        // Either many chunks or low average line count
        const avgLines = ep.chunks.reduce(
          (s, c) => s + c.contentPlain.split("\n").length, 0
        ) / ep.chunks.length;
        expect(ep.chunks.length > 12 || avgLines < 3).toBe(true);
      }
    }
  });
});

const hasLocalData = (() => {
  try {
    return existsSync("data/raw/1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html");
  } catch {
    return false;
  }
})();

describe.skipIf(!hasLocalData)("format detection on real local data", () => {
  it("small archive doc (1IPw) detected as essays", () => {
    const html = readFileSync("data/raw/1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html", "utf-8");
    const episodes = parseHtmlDocument(html);
    expect(episodes.length).toBeGreaterThan(0);
    for (const ep of episodes) {
      expect(ep.format).toBe("essays");
    }
  });

  it("current doc (1xRi) detected as notes", () => {
    const html = readFileSync("data/raw/1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA.html", "utf-8");
    const episodes = parseHtmlDocument(html);
    expect(episodes.length).toBeGreaterThan(0);
    for (const ep of episodes) {
      expect(ep.format).toBe("notes");
    }
  });
});
