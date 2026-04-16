import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  CURRENT_NORMALIZATION_VERSION,
  normalizeChunkText,
  tokenizeNormalizedText,
  countTokenFrequencies,
} from "./analysis-text";

describe("normalizeChunkText", () => {
  it("normalizes HTML entities, quotes, dashes, and whitespace once", () => {
    const artifact = normalizeChunkText("It&#39;s\u00a0\u201cquoted\u201d\n\ntext\u2014with\tspacing");

    expect(artifact.normalizedText).toBe("It's \"quoted\" text-with spacing");
    expect(artifact.normalizationVersion).toBe(CURRENT_NORMALIZATION_VERSION);
    expect(artifact.warnings).toEqual([]);
  });

  it("flags empty chunks after normalization", () => {
    const artifact = normalizeChunkText("\u00a0 \n \t");

    expect(artifact.normalizedText).toBe("");
    expect(artifact.warnings).toContain("empty_after_normalization");
  });
});

describe("normalizeChunkText properties", () => {
  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (input) => {
        const once = normalizeChunkText(input).normalizedText;
        const twice = normalizeChunkText(once).normalizedText;
        expect(twice).toBe(once);
      })
    );
  });
});

describe("tokenizeNormalizedText", () => {
  it("reuses the normalized token stream for downstream word counts", () => {
    const normalized = normalizeChunkText("The quick brown foxes jump. Quick brown ideas.");
    const tokens = tokenizeNormalizedText(normalized.normalizedText);
    const counts = countTokenFrequencies(tokens);

    expect(tokens).toEqual(["quick", "brown", "foxes", "jump", "quick", "brown", "ideas"]);
    expect(counts.get("quick")).toBe(2);
    expect(counts.get("brown")).toBe(2);
    expect(counts.get("foxes")).toBe(1);
  });
});
