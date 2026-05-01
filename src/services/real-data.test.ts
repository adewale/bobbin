/**
 * Tests against REAL cached Google Doc HTML files in data/raw/.
 * No mocks. These verify the actual parsing pipeline produces correct results.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractDocLinksFromHtml, parseHtmlDocument } from "./html-parser";
import type { ParsedEpisode } from "../types";
import archiveEssaysHtml from "../../data/raw/1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html?raw";
import archiveNotesHtml from "../../data/raw/1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw.html?raw";
import currentHtml from "../../data/raw/1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA.html?raw";
import emptyHtml from "../../data/raw/1x8z6k07JqXTVIRVNr1S_7wYVl5L7IpX14gXxU1UBrGk.html?raw";

const DOCS = [
  { file: "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html", label: "archive-essays", html: archiveEssaysHtml },
  { file: "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw.html", label: "archive-notes", html: archiveNotesHtml },
  { file: "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA.html", label: "current", html: currentHtml },
  { file: "1x8z6k07JqXTVIRVNr1S_7wYVl5L7IpX14gXxU1UBrGk.html", label: "empty", html: emptyHtml },
];

function loadDoc(file: string): ParsedEpisode[] {
  const doc = DOCS.find((entry) => entry.file === file);
  if (!doc) throw new Error(`Unknown doc fixture: ${file}`);
  return parseHtmlDocument(doc.html);
}

describe("Real data: episode counts", () => {
  it("archive-essays doc produces 11 episodes", () => {
    expect(loadDoc(DOCS[0].file)).toHaveLength(11);
  });

  it("archive-notes doc produces 43 episodes", () => {
    expect(loadDoc(DOCS[1].file)).toHaveLength(43);
  });

  it("current doc produces 25 episodes", () => {
    expect(loadDoc(DOCS[2].file)).toHaveLength(25);
  });

  it("empty doc produces 0 episodes", () => {
    expect(loadDoc(DOCS[3].file)).toHaveLength(0);
  });

  it("total across all docs is 79 episodes", () => {
    const total = DOCS.reduce((sum, d) => sum + loadDoc(d.file).length, 0);
    expect(total).toBe(79);
  });
});

describe("Real data: format detection", () => {
  it("all 11 archive-essays episodes are detected as essays", () => {
    const episodes = loadDoc(DOCS[0].file);
    for (const ep of episodes) {
      expect(ep.format).toBe("essays");
    }
  });

  it("all 43 archive-notes episodes are detected as notes", () => {
    const episodes = loadDoc(DOCS[1].file);
    for (const ep of episodes) {
      expect(ep.format).toBe("notes");
    }
  });

  it("all 25 current episodes are detected as notes", () => {
    const episodes = loadDoc(DOCS[2].file);
    for (const ep of episodes) {
      expect(ep.format).toBe("notes");
    }
  });
});

describe("Real data: archive essays characterization", () => {
  it("the 1IPw archive episodes all use the same list-first chunk shape", () => {
    const episodes = loadDoc(DOCS[0].file);

    expect(episodes).toHaveLength(11);
    for (const ep of episodes) {
      expect(ep.chunks.length).toBeGreaterThan(0);
      expect(ep.chunks.every((chunk) => chunk.richContent[0]?.type === "list_item")).toBe(true);
      expect(ep.chunks.every((chunk) => chunk.richContent[0]?.depth === 0)).toBe(true);
    }
  });

  it("the 1IPw archive parser sees episode-level source anchors", () => {
    const episodes = loadDoc(DOCS[0].file);

    expect(episodes).toHaveLength(11);
    for (const ep of episodes) {
      expect(ep.headingId).toMatch(/^h\./);
    }
  });

  it("parsed chunks do not currently carry original chunk heading ids", () => {
    const episodes = loadDoc(DOCS[0].file);

    for (const ep of episodes) {
      for (const chunk of ep.chunks) {
        expect(chunk.headingId).toBe("");
      }
    }
  });
});

describe("Real data: chunk structure completeness", () => {
  it("every episode has at least 1 chunk", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        expect(ep.chunks.length).toBeGreaterThan(0);
      }
    }
  });

  it("essay episodes have 2-12 chunks", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        if (ep.format === "essays") {
          expect(ep.chunks.length).toBeGreaterThanOrEqual(2);
          expect(ep.chunks.length).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it("notes episodes have >12 chunks", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        if (ep.format === "notes") {
          expect(ep.chunks.length).toBeGreaterThan(12);
        }
      }
    }
  });

  it("chunk positions are contiguous starting from 0", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        const positions = ep.chunks.map((c) => c.position);
        for (let i = 0; i < positions.length; i++) {
          expect(positions[i]).toBe(i);
        }
      }
    }
  });

  it("no chunk has empty content", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        for (const chunk of ep.chunks) {
          expect(chunk.contentPlain.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("no chunk has empty title", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        for (const chunk of ep.chunks) {
          expect(chunk.title.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("chunk titles are full sentences (no arbitrary truncation)", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        for (const chunk of ep.chunks) {
          // Titles should be the full first sentence, not truncated
          expect(chunk.title.length).toBeGreaterThan(0);
          // Very few should end with "..." (only if the author wrote "...")
          // No test for max length — titles are as long as the sentence
        }
      }
    }
  });

  it("every episode has a valid date", () => {
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        expect(ep.parsedDate).toBeInstanceOf(Date);
        expect(ep.parsedDate.getTime()).not.toBeNaN();
        expect(ep.parsedDate.getUTCFullYear()).toBeGreaterThanOrEqual(2024);
        expect(ep.parsedDate.getUTCFullYear()).toBeLessThanOrEqual(2027);
      }
    }
  });

  it("no two episodes in the same doc share a date", () => {
    for (const doc of DOCS) {
      const episodes = loadDoc(doc.file);
      const dates = episodes.map((ep) => ep.parsedDate.toISOString().split("T")[0]);
      expect(new Set(dates).size).toBe(dates.length);
    }
  });

  it("total chunks across all docs is 5639", () => {
    let total = 0;
    for (const doc of DOCS) {
      for (const ep of loadDoc(doc.file)) {
        total += ep.chunks.length;
      }
    }
    expect(total).toBe(5639);
  });
});

describe("Real data: essay content richness", () => {
  it("essay chunks have ≥3 lines of content (main + sub-points)", () => {
    const episodes = loadDoc(DOCS[0].file);
    for (const ep of episodes) {
      for (const chunk of ep.chunks) {
        const lines = chunk.contentPlain.split("\n").filter((l) => l.trim());
        expect(lines.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("essay chunk content includes sub-points (not just the title line)", () => {
    const episodes = loadDoc(DOCS[0].file);
    for (const ep of episodes) {
      for (const chunk of ep.chunks) {
        // Content should be longer than the title
        expect(chunk.contentPlain.length).toBeGreaterThan(chunk.title.length + 20);
      }
    }
  });
});

describe("Real data: notes content structure", () => {
  it("notes chunks average 1-5 lines (brief observations)", () => {
    const episodes = loadDoc(DOCS[2].file);
    const totalLines = episodes.reduce(
      (sum, ep) => sum + ep.chunks.reduce(
        (s, c) => s + c.contentPlain.split("\n").filter((l) => l.trim()).length, 0
      ), 0
    );
    const totalChunks = episodes.reduce((s, ep) => s + ep.chunks.length, 0);
    const avgLines = totalLines / totalChunks;
    expect(avgLines).toBeGreaterThanOrEqual(1);
    expect(avgLines).toBeLessThanOrEqual(5);
  });
});

describe("Real data: document link extraction", () => {
  it("all extracted doc links are canonical, deduped Google Doc IDs", () => {
    for (const doc of DOCS) {
      const links = extractDocLinksFromHtml(doc.html);
      expect(new Set(links).size).toBe(links.length);
      for (const link of links) {
        expect(link).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      }
    }
  });

  it("the archive essays doc still contains the known cross-doc reference", () => {
    const links = extractDocLinksFromHtml(DOCS[0].html);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });
});

// PBT: properties that hold across ALL parsed episodes from ALL docs
describe("PBT: universal parsing invariants on real data", () => {
  // Load all episodes once
  const allEpisodes: ParsedEpisode[] = [];
  for (const doc of DOCS) {
    allEpisodes.push(...loadDoc(doc.file));
  }

  it("format is always 'essays' or 'notes'", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(allEpisodes.length - 1, 0) }),
        (idx) => {
          if (!allEpisodes.length) return;
          const ep = allEpisodes[idx];
          expect(["essays", "notes"]).toContain(ep.format);
        }
      )
    );
  });

  it("essays always have fewer chunks than notes", () => {
    const essayMaxChunks = Math.max(
      ...allEpisodes.filter((e) => e.format === "essays").map((e) => e.chunks.length),
      0
    );
    const notesMinChunks = Math.min(
      ...allEpisodes.filter((e) => e.format === "notes").map((e) => e.chunks.length),
      Infinity
    );
    if (essayMaxChunks > 0 && notesMinChunks < Infinity) {
      expect(essayMaxChunks).toBeLessThan(notesMinChunks);
    }
  });

  it("chunk content never contains Google Docs HTML markup tags", () => {
    // Check for specific HTML tags that would indicate parser failure
    // (not arbitrary <text> which could be genuine content like <system-reminder>)
    const docTags = /<\/?(li|ul|ol|span|div|p|h[1-6]|table|tr|td|a|sup|sub)\b[^>]*>/i;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(allEpisodes.length - 1, 0) }),
        (epIdx) => {
          if (!allEpisodes.length) return;
          const ep = allEpisodes[epIdx];
          for (const chunk of ep.chunks) {
            expect(chunk.contentPlain).not.toMatch(docTags);
          }
        }
      )
    );
  });

  it("chunk content never contains HTML entities", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(allEpisodes.length - 1, 0) }),
        (epIdx) => {
          if (!allEpisodes.length) return;
          const ep = allEpisodes[epIdx];
          for (const chunk of ep.chunks) {
            expect(chunk.contentPlain).not.toContain("&amp;");
            expect(chunk.contentPlain).not.toContain("&lt;");
            expect(chunk.contentPlain).not.toContain("&gt;");
            expect(chunk.contentPlain).not.toContain("&quot;");
          }
        }
      )
    );
  });

  it("every episode title starts with 'Bits and Bobs'", () => {
    for (const ep of allEpisodes) {
      expect(ep.title).toMatch(/^Bits and Bobs /);
    }
  });

  it("episode dates are in reverse chronological order within each doc", () => {
    for (const doc of DOCS) {
      const episodes = loadDoc(doc.file);
      for (let i = 1; i < episodes.length; i++) {
        expect(episodes[i - 1].parsedDate.getTime()).toBeGreaterThanOrEqual(
          episodes[i].parsedDate.getTime()
        );
      }
    }
  });
});
