import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { tokenizeForWordStats } from "./word-stats";
import { STOPWORDS } from "../lib/text";

describe("tokenizeForWordStats properties", () => {
  it("output never contains stopwords", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const result = tokenizeForWordStats(input);
        for (const [word] of result) {
          expect(STOPWORDS.has(word)).toBe(false);
        }
      })
    );
  });

  it("all word counts are positive", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const result = tokenizeForWordStats(input);
        for (const [, count] of result) {
          expect(count).toBeGreaterThan(0);
        }
      })
    );
  });

  it("all words are > 3 characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const result = tokenizeForWordStats(input);
        for (const [word] of result) {
          expect(word.length).toBeGreaterThan(3);
        }
      })
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), (input) => {
        const first = tokenizeForWordStats(input);
        const second = tokenizeForWordStats(input);
        expect(first).toEqual(second);
      })
    );
  });

  it("word appearing N times in input has count N", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 15 }).filter(
          (s) => /^[a-z]+$/.test(s) && !STOPWORDS.has(s) && s.length > 3
        ),
        fc.integer({ min: 1, max: 5 }),
        (word, repeats) => {
          const text = Array(repeats).fill(word).join(" ");
          const result = tokenizeForWordStats(text);
          expect(result.get(word)).toBe(repeats);
        }
      )
    );
  });
});
