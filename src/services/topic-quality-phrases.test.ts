/**
 * RED tests for multi-word topic quality.
 *
 * Bug: "everyone believe" passes isNoiseTopic because the filter only
 * checks the FULL phrase, not component words. "believe" is in NOISE_WORDS
 * but "everyone believe" as a phrase is not.
 */
import { describe, it, expect } from "vitest";
import { isNoiseTopic } from "./topic-quality";
import fc from "fast-check";

describe("isNoiseTopic catches multi-word phrases containing noise words", () => {
  it("rejects 'everyone believe' (contains noise word 'believe')", () => {
    expect(isNoiseTopic("everyone believe")).toBe(true);
  });

  it("rejects 'make believe' (both words are filler)", () => {
    expect(isNoiseTopic("make believe")).toBe(true);
  });

  it("rejects 'someone else' (generic pronoun phrase)", () => {
    expect(isNoiseTopic("someone else")).toBe(true);
  });

  it("keeps 'machine learning' (neither word is noise alone in this context)", () => {
    expect(isNoiseTopic("machine learning")).toBe(false);
  });

  it("keeps 'Claude Code' (entity-like, not noise)", () => {
    expect(isNoiseTopic("Claude Code")).toBe(false);
  });

  it("keeps 'gilded turd' (specific newsletter concept)", () => {
    expect(isNoiseTopic("gilded turd")).toBe(false);
  });

  it("PBT: phrases where ALL words are filler should be noise", () => {
    // These are the FILLER_WORDS used for multi-word filtering
    const fillerWords = ["make", "take", "give", "keep", "come", "show", "need", "want", "like", "believe", "think", "know"];
    fc.assert(
      fc.property(
        fc.constantFrom(...fillerWords),
        fc.constantFrom(...fillerWords),
        (w1, w2) => {
          if (w1 !== w2) {
            expect(isNoiseTopic(`${w1} ${w2}`)).toBe(true);
          }
        }
      )
    );
  });
});
