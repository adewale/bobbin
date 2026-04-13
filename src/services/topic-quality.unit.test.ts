/**
 * Exhaustive unit tests for isNoiseTopic.
 * Separate from topic-quality.test.ts which tests curateTopics.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isNoiseTopic } from "./topic-quality";

describe("isNoiseTopic", () => {
  // === Positive cases: words that SHOULD be noise ===

  it.each([
    "system", "software", "model", "data", "code", "product", "tool",
  ])("returns true for generic noun: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(true);
  });

  it.each([
    "harder", "easier", "faster", "better", "worse",
    "higher", "lower", "deeper", "wider", "longer", "shorter",
    "stronger", "weaker", "bigger", "smaller", "slower",
  ])("returns true for comparative/superlative adjective: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(true);
  });

  it.each([
    "allow", "create", "enable", "require",
    "become", "becoming", "imagine", "assume",
    "consider", "approach", "change", "changing", "started",
  ])("returns true for generic verb: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(true);
  });

  it.each([
    "injection", "labor", "hollow", "coding", "vibe",
  ])("returns true for word meaningful only in phrases: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(true);
  });

  it.each([
    "fundamentally", "basically", "essentially", "relatively",
  ])("returns true for filler adverb: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(true);
  });

  it.each([
    "expensive", "important", "interesting", "different",
    "aligned", "leverage", "focused", "driven", "based", "built", "designed",
  ])("returns true for generic adjective/participle: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(true);
  });

  // === Negative cases: words that should NOT be noise ===

  it.each([
    "resonant", "emergent", "llms", "chatbot", "swarm", "ecosystem",
  ])("returns false for legitimate topic: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(false);
  });

  it.each([
    "chatgpt", "anthropic", "openai",
  ])("returns false for company/product name: %s", (word) => {
    expect(isNoiseTopic(word)).toBe(false);
  });

  it.each([
    "prompt injection", "infinite software", "claude code",
    "vibe coding", "cognitive labor",
  ])("returns false for multi-word phrase: %s", (phrase) => {
    expect(isNoiseTopic(phrase)).toBe(false);
  });

  // === Edge cases: short words ===

  it("returns true for words shorter than 4 chars", () => {
    expect(isNoiseTopic("app")).toBe(true);
    expect(isNoiseTopic("ai")).toBe(true);
    expect(isNoiseTopic("ml")).toBe(true);
  });

  it("does NOT filter short multi-word phrases", () => {
    // "ai ml" has a space, so the < 4 char rule should not apply
    expect(isNoiseTopic("ai ml")).toBe(false);
  });

  it("allows 4-char words that are not in the noise set", () => {
    expect(isNoiseTopic("rust")).toBe(false);
    expect(isNoiseTopic("wasm")).toBe(false);
  });

  // === Case insensitivity ===

  it("is case insensitive for noise words", () => {
    expect(isNoiseTopic("System")).toBe(true);
    expect(isNoiseTopic("SYSTEM")).toBe(true);
    expect(isNoiseTopic("SyStEm")).toBe(true);
  });

  it("is case insensitive for legitimate words too", () => {
    expect(isNoiseTopic("Ecosystem")).toBe(false);
    expect(isNoiseTopic("ECOSYSTEM")).toBe(false);
  });

  // === Property-based tests ===

  it("never crashes and always returns boolean for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = isNoiseTopic(s);
        expect(typeof result).toBe("boolean");
      })
    );
  });

  it("always returns true for all words in NOISE_WORDS set", () => {
    // Test all known noise words exhaustively
    const knownNoise = [
      "harder", "easier", "faster", "slower", "bigger", "smaller", "better", "worse",
      "higher", "lower", "deeper", "wider", "longer", "shorter", "stronger", "weaker",
      "aligned", "leverage", "focused", "driven", "based", "built", "designed",
      "allow", "create", "enable", "require", "involve", "include",
      "fundamentally", "basically", "essentially", "relatively",
      "become", "becoming", "happened", "happening", "imagine", "assume",
      "consider", "approach", "change", "changing", "started",
      "software", "system", "model", "data", "code", "product", "tool", "tools",
      "products", "apps", "thing", "things", "people", "person", "world", "point",
      "part", "kind", "type", "time", "place", "work", "idea", "value", "case",
      "form", "record", "trust", "quality", "business", "power", "matter",
      "action", "process", "company", "individual", "future", "order",
      "space", "level", "layer", "number", "result", "problem", "question",
      "state", "sense", "reason", "experience", "example", "information",
      "content", "version", "source", "feature", "user", "users",
      "expensive", "important", "interesting", "different",
      "require", "exist", "expect", "possible", "specific",
      "scale", "cost", "society", "team", "loop", "care", "other",
      "context", "tech", "infinite", "signal", "market", "internal",
      "injection", "labor", "hollow", "coding", "vibe",
    ];
    for (const word of knownNoise) {
      expect(isNoiseTopic(word)).toBe(true);
    }
    // Verify the total count matches expectations (no missing words)
    expect(knownNoise.length).toBeGreaterThanOrEqual(90);
  });

  it("multi-word phrases containing noise words are not filtered", () => {
    // The function only checks the full name, not individual words
    fc.assert(
      fc.property(
        fc.constantFrom("system", "software", "model", "data", "code"),
        fc.stringMatching(/^[a-z]{4,10}$/),
        (noise, suffix) => {
          const phrase = `${noise} ${suffix}`;
          // Multi-word phrases are not in the NOISE_WORDS set
          expect(isNoiseTopic(phrase)).toBe(false);
        }
      )
    );
  });

  it("returns true for empty string (length < 4)", () => {
    expect(isNoiseTopic("")).toBe(true);
  });

  it("returns true for single character (length < 4)", () => {
    expect(isNoiseTopic("a")).toBe(true);
    expect(isNoiseTopic("x")).toBe(true);
  });
});
