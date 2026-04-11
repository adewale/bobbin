import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { tokenize, stripToPlainText, countWords, STOPWORDS } from "./text";

describe("tokenize properties", () => {
  it("output never contains a stopword", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const tokens = tokenize(input);
        for (const token of tokens) {
          expect(STOPWORDS.has(token)).toBe(false);
        }
      })
    );
  });

  it("output tokens are always > 3 characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const tokens = tokenize(input);
        for (const token of tokens) {
          expect(token.length).toBeGreaterThan(3);
        }
      })
    );
  });

  it("output tokens are always lowercase", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const tokens = tokenize(input);
        for (const token of tokens) {
          expect(token).toBe(token.toLowerCase());
        }
      })
    );
  });

  it("empty input produces empty output", () => {
    expect(tokenize("")).toHaveLength(0);
  });
});

describe("stripToPlainText properties", () => {
  it("strips all HTML tags from input", () => {
    fc.assert(
      fc.property(
        // Use only alphanumeric + spaces to avoid entity/special char edge cases
        fc.stringMatching(/^[a-zA-Z0-9 ]{1,80}$/),
        (content) => {
          const html = `<div class="test"><p>${content}</p></div>`;
          const result = stripToPlainText(html);
          expect(result).not.toContain("<div");
          expect(result).not.toContain("<p>");
          const normalized = content.trim().replace(/\s+/g, " ");
          if (normalized) {
            expect(result).toContain(normalized);
          }
        }
      )
    );
  });

  it("output never has consecutive spaces", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), (input) => {
        const result = stripToPlainText(input);
        expect(result).not.toContain("  ");
      })
    );
  });
});

describe("countWords properties", () => {
  it("always returns non-negative", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(countWords(input)).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it("words joined by single spaces roundtrip", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0 && !s.includes(" ")), { minLength: 1, maxLength: 10 }),
        (words) => {
          const text = words.join(" ");
          expect(countWords(text)).toBe(words.length);
        }
      )
    );
  });
});
