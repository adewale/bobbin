import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeDistinctiveness,
  loadEnglishBaseline,
  type DistinctivenessResult,
} from "./distinctiveness";

describe("loadEnglishBaseline", () => {
  it("loads the reference word list", () => {
    const baseline = loadEnglishBaseline();
    expect(baseline.size).toBeGreaterThan(500);
    expect(baseline.has("the")).toBe(true);
    expect(baseline.has("and")).toBe(true);
    expect(baseline.has("software")).toBe(true);
  });
});

describe("computeDistinctiveness", () => {
  const baseline = loadEnglishBaseline();

  it("domain terms get high distinctiveness scores", () => {
    const corpusFreq = new Map([
      ["llms", 500],
      ["agentic", 80],
      ["the", 2000],
      ["and", 1500],
    ]);
    const totalWords = 50000;

    const results = computeDistinctiveness(corpusFreq, totalWords, baseline);

    // "llms" and "agentic" should score high (not in baseline or rare in English)
    const llms = results.find((r) => r.word === "llms");
    const agentic = results.find((r) => r.word === "agentic");
    const theWord = results.find((r) => r.word === "the");

    expect(llms).toBeDefined();
    expect(llms!.distinctiveness).toBeGreaterThan(1);
    expect(agentic!.distinctiveness).toBeGreaterThan(1);

    // "the" should score low (very common in English)
    if (theWord) {
      expect(theWord.distinctiveness).toBeLessThan(llms!.distinctiveness);
    }
  });

  it("results are sorted by distinctiveness descending", () => {
    const corpusFreq = new Map([
      ["llms", 500],
      ["software", 300],
      ["the", 2000],
    ]);
    const results = computeDistinctiveness(corpusFreq, 50000, baseline);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].distinctiveness).toBeGreaterThanOrEqual(
        results[i].distinctiveness
      );
    }
  });
});


describe("PBT: distinctiveness invariants", () => {
  const baseline = loadEnglishBaseline();

  it("distinctiveness is always >= 0", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.string({ minLength: 4, maxLength: 15 }).filter((s) => /^[a-z]+$/.test(s)),
            fc.integer({ min: 1, max: 1000 })
          ),
          { minLength: 1, maxLength: 20 }
        ),
        (entries) => {
          const freq = new Map(entries);
          const total = entries.reduce((s, [, c]) => s + c, 0);
          const results = computeDistinctiveness(freq, total, baseline);
          for (const r of results) {
            expect(r.distinctiveness).toBeGreaterThanOrEqual(0);
          }
        }
      )
    );
  });

  it("words not in English baseline get maximum distinctiveness", () => {
    const freq = new Map([["xyznonword", 10]]);
    const results = computeDistinctiveness(freq, 1000, baseline);
    expect(results.length).toBe(1);
    expect(results[0].distinctiveness).toBeGreaterThan(5);
  });
});
