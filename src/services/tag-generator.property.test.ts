import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractTags } from "./tag-generator";
import { STOPWORDS } from "../lib/text";

describe("extractTags properties", () => {
  it("never exceeds maxTags", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 500 }),
        fc.integer({ min: 1, max: 10 }),
        (text, maxTags) => {
          const tags = extractTags(text, maxTags);
          expect(tags.length).toBeLessThanOrEqual(maxTags);
        }
      )
    );
  });

  it("tag slugs always match /^[a-z0-9-]*$/", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const tags = extractTags(text);
        for (const tag of tags) {
          expect(tag.slug).toMatch(/^[a-z0-9-]*$/);
        }
      })
    );
  });

  it("tag names never contain HTML entities", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        // Add HTML entities to the input
        const withEntities = text + " it&#39;s &amp; &lt;bold&gt; &quot;quoted&quot;";
        const tags = extractTags(withEntities);
        for (const tag of tags) {
          expect(tag.name).not.toContain("&#");
          expect(tag.name).not.toContain("&amp;");
          expect(tag.name).not.toContain("&lt;");
          expect(tag.name).not.toContain("&gt;");
          expect(tag.name).not.toContain("&quot;");
        }
      })
    );
  });

  it("tag names are never stopwords", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const tags = extractTags(text);
        for (const tag of tags) {
          // Single-word tags should not be stopwords
          if (!tag.name.includes(" ")) {
            expect(STOPWORDS.has(tag.name)).toBe(false);
          }
        }
      })
    );
  });

  it("is deterministic — same input always produces same output", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 300 }), (text) => {
        const first = extractTags(text);
        const second = extractTags(text);
        expect(first).toEqual(second);
      })
    );
  });

  it("tag names are always > 3 characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const tags = extractTags(text);
        for (const tag of tags) {
          expect(tag.name.length).toBeGreaterThan(3);
        }
      })
    );
  });
});
