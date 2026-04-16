import { describe, expect, it } from "vitest";
import { extractRuntimeYakeKeywords, normalizeTopicExtractorMode } from "./yake-runtime";

const SAMPLE_TEXT = "Google is acquiring data science community Kaggle. Google is hosting Cloud Next and Kaggle remains central to data science competitions.";

describe("yake runtime switch", () => {
  it("normalizes unknown modes back to naive", () => {
    expect(normalizeTopicExtractorMode(undefined)).toBe("naive");
    expect(normalizeTopicExtractorMode("naive")).toBe("naive");
    expect(normalizeTopicExtractorMode("yaket")).toBe("yaket");
    expect(normalizeTopicExtractorMode("something-else")).toBe("naive");
  });

  it("returns Bobbin-compatible keyword results for both implementations", () => {
    const naive = extractRuntimeYakeKeywords(SAMPLE_TEXT, 5, 3, "naive");
    const yaket = extractRuntimeYakeKeywords(SAMPLE_TEXT, 5, 3, "yaket");

    for (const resultSet of [naive, yaket]) {
      expect(resultSet.length).toBeGreaterThan(0);
      expect(resultSet.length).toBeLessThanOrEqual(5);
      for (const keyword of resultSet) {
        expect(typeof keyword.keyword).toBe("string");
        expect(typeof keyword.score).toBe("number");
        expect(Number.isFinite(keyword.score)).toBe(true);
      }
    }
  });

  it("yaket mode is deterministic for the same input", () => {
    const first = extractRuntimeYakeKeywords(SAMPLE_TEXT, 8, 3, "yaket");
    const second = extractRuntimeYakeKeywords(SAMPLE_TEXT, 8, 3, "yaket");
    expect(second).toEqual(first);
  });
});
