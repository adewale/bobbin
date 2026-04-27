import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  blendTopicSimilarity,
  computeSpanAwareBurstScore,
  cosineSimilarity,
  enumerateQuarterKeys,
  meanPoolVectors,
  quarterKeyFromIsoDate,
  topicSupportThreshold,
} from "./topic-metrics";

describe("topicSupportThreshold", () => {
  it("stays at least 2 for small corpora", () => {
    expect(topicSupportThreshold(1)).toBe(2);
    expect(topicSupportThreshold(2)).toBe(2);
    expect(topicSupportThreshold(3)).toBe(2);
  });

  it("grows with corpus size", () => {
    expect(topicSupportThreshold(4)).toBe(2);
    expect(topicSupportThreshold(5)).toBe(3);
    expect(topicSupportThreshold(8)).toBe(3);
    expect(topicSupportThreshold(9)).toBe(4);
  });

  it("property: is monotonic over episode count", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (left, right) => {
          const min = Math.min(left, right);
          const max = Math.max(left, right);
          expect(topicSupportThreshold(max)).toBeGreaterThanOrEqual(topicSupportThreshold(min));
        },
      ),
    );
  });
});

describe("quarter helpers", () => {
  it("maps ISO dates to year-quarter keys", () => {
    expect(quarterKeyFromIsoDate("2025-01-06")).toBe("2025-Q1");
    expect(quarterKeyFromIsoDate("2025-07-06")).toBe("2025-Q3");
  });

  it("enumerates inclusive quarter spans", () => {
    expect(enumerateQuarterKeys("2025-Q2", "2026-Q1")).toEqual([
      "2025-Q2",
      "2025-Q3",
      "2025-Q4",
      "2026-Q1",
    ]);
  });
});

describe("computeSpanAwareBurstScore", () => {
  it("returns 1 for a flat topic across its active span", () => {
    const counts = new Map([
      ["2025-Q1", 3],
      ["2025-Q2", 3],
      ["2025-Q3", 3],
    ]);
    const burst = computeSpanAwareBurstScore(counts, "2025-Q1", "2025-Q3");
    expect(burst.score).toBe(1);
    expect(burst.peakQuarter).toBe("2025-Q1");
    expect(burst.spanQuarterCount).toBe(3);
  });

  it("captures when attention is concentrated in one quarter", () => {
    const counts = new Map([
      ["2025-Q1", 1],
      ["2025-Q2", 7],
      ["2025-Q3", 0],
      ["2025-Q4", 0],
    ]);
    const burst = computeSpanAwareBurstScore(counts, "2025-Q1", "2025-Q4");
    expect(burst.score).toBeCloseTo(3.5, 5);
    expect(burst.peakQuarter).toBe("2025-Q2");
    expect(burst.peakCount).toBe(7);
  });
});

describe("topic similarity math", () => {
  it("mean-pools vectors of equal width", () => {
    expect(meanPoolVectors([[1, 3], [3, 5]])).toEqual([2, 4]);
  });

  it("returns null for incompatible vectors", () => {
    expect(meanPoolVectors([[1, 2], [1]])).toBeNull();
    expect(cosineSimilarity([1, 2], [1])).toBeNull();
  });

  it("property: cosine is symmetric and blend stays bounded", () => {
    const vectorArbitrary = fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 3, maxLength: 3 });
    fc.assert(
      fc.property(vectorArbitrary, vectorArbitrary, fc.float({ min: 0, max: 1, noNaN: true }), (left, right, jaccard) => {
        const forward = cosineSimilarity(left, right);
        const backward = cosineSimilarity(right, left);
        expect(forward === null ? backward : backward).toBe(forward);
        const blended = blendTopicSimilarity(forward, jaccard);
        expect(blended).toBeGreaterThanOrEqual(0);
        expect(blended).toBeLessThanOrEqual(1);
      }),
    );
  });
});
