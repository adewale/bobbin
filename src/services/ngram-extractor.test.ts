import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractCorpusNgrams } from "./ngram-extractor";

describe("extractCorpusNgrams", () => {
  it("finds 'prompt injection' across multiple texts", () => {
    const texts = [
      "Prompt injection is a serious concern for LLM applications",
      "The risk of prompt injection attacks grows with deployment",
      "Defending against prompt injection requires multiple layers",
      "Prompt injection can bypass system prompts entirely",
      "More on prompt injection defense strategies here",
    ];
    const results = extractCorpusNgrams(texts, 3, 3);
    const phrases = results.map(r => r.phrase);
    expect(phrases).toContain("prompt injection");
  });

  it("filters out phrases below minCount", () => {
    const texts = [
      "prompt injection is dangerous",
      "prompt injection is common",
      "this text has no relevant phrases",
    ];
    // minCount = 5 — "prompt injection" only appears in 2 docs
    const results = extractCorpusNgrams(texts, 5, 1);
    expect(results.length).toBe(0);
  });

  it("filters out phrases below minDocs", () => {
    const texts = [
      "prompt injection prompt injection prompt injection prompt injection prompt injection",
    ];
    // minDocs = 3, but only 1 document (though counted once per doc)
    const results = extractCorpusNgrams(texts, 1, 3);
    expect(results.length).toBe(0);
  });

  it("never crashes on arbitrary input (PBT)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 200 }), { minLength: 0, maxLength: 10 }),
        (texts) => {
          const results = extractCorpusNgrams(texts, 1, 1);
          expect(Array.isArray(results)).toBe(true);
          for (const r of results) {
            expect(typeof r.phrase).toBe("string");
            expect(typeof r.count).toBe("number");
            expect(typeof r.docCount).toBe("number");
            expect(r.count).toBeGreaterThanOrEqual(1);
            expect(r.docCount).toBeGreaterThanOrEqual(1);
          }
        }
      )
    );
  });
});
