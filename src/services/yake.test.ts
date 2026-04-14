/**
 * Tests for YAKE keyword extraction (pure JS implementation).
 *
 * YAKE (Yet Another Keyword Extractor) uses within-document statistical
 * features instead of corpus-wide IDF. It naturally produces multi-word
 * keyphrases and scores them by importance (lower = better).
 *
 * Reference: Campos et al., "YAKE! Keyword extraction from single documents
 * using multiple local features", Information Sciences, 2020.
 */
import { describe, it, expect } from "vitest";
import { extractYakeKeywords } from "./yake";

describe("extractYakeKeywords", () => {
  it("extracts multi-word keyphrases from text", () => {
    const text = "OpenAI released ChatGPT and the world changed. " +
      "Consumer AI is being absorbed by platforms. " +
      "Enterprise AI converges around a few vendors.";
    const keywords = extractYakeKeywords(text, 5);

    expect(keywords.length).toBeLessThanOrEqual(5);
    expect(keywords.length).toBeGreaterThan(0);
    // Should produce multi-word phrases, not just single words
    const multiWord = keywords.filter(k => k.keyword.includes(" "));
    expect(multiWord.length).toBeGreaterThan(0);
  });

  it("scores domain terms higher than generic words", () => {
    const text = "The transformer architecture enables large language models. " +
      "LLMs use attention mechanisms for token prediction. " +
      "The ecosystem evolves through swarm coordination.";
    const keywords = extractYakeKeywords(text, 10);
    const names = keywords.map(k => k.keyword);

    // Domain terms should appear
    const hasDomainTerm = names.some(n =>
      n.includes("transformer") || n.includes("language model") ||
      n.includes("attention") || n.includes("swarm")
    );
    expect(hasDomainTerm).toBe(true);
  });

  it("returns keywords with scores (lower = more important)", () => {
    const text = "Machine learning and deep learning are subfields of artificial intelligence.";
    const keywords = extractYakeKeywords(text, 5);

    for (const kw of keywords) {
      expect(kw).toHaveProperty("keyword");
      expect(kw).toHaveProperty("score");
      expect(typeof kw.score).toBe("number");
      expect(kw.score).toBeGreaterThan(0);
    }
    // Sorted by score ascending (best first)
    for (let i = 1; i < keywords.length; i++) {
      expect(keywords[i].score).toBeGreaterThanOrEqual(keywords[i - 1].score);
    }
  });

  it("does not extract stopword-only phrases", () => {
    const text = "The thing is that this and that are different from those.";
    const keywords = extractYakeKeywords(text, 5);
    // No keyword should be only stopwords
    for (const kw of keywords) {
      expect(kw.keyword).not.toMatch(/^(the|is|that|this|and|are|from|those|a|an|in|on|to|for|of|it|with)\b/i);
    }
  });

  it("handles empty and very short texts", () => {
    expect(extractYakeKeywords("", 5)).toEqual([]);
    expect(extractYakeKeywords("Hello", 5).length).toBeLessThanOrEqual(1);
    expect(extractYakeKeywords("AI is great.", 5).length).toBeGreaterThanOrEqual(0);
  });

  it("does not crash on arbitrary input", () => {
    const inputs = [
      "Normal text about things.",
      "ALL CAPS SENTENCE HERE NOW",
      "a b c d e f g h i j k l m n o p",
      "   lots   of   spaces   ",
      "Numbers 123 and symbols @#$ mixed in",
      "Single",
    ];
    for (const input of inputs) {
      const result = extractYakeKeywords(input, 5);
      expect(Array.isArray(result)).toBe(true);
    }
  });

  // Patterns from upstream YAKE tests: https://github.com/INESCTEC/yake/tree/master/tests

  it("is deterministic: same text always produces same results", () => {
    const text = "Google is acquiring data science community Kaggle. " +
      "The deal is worth a reported million dollars. " +
      "Google will integrate Kaggle into cloud platform.";
    const run1 = extractYakeKeywords(text, 5);
    const run2 = extractYakeKeywords(text, 5);
    const run3 = extractYakeKeywords(text, 5);

    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });

  it("all scores are positive (no NaN, no negative, no infinite)", () => {
    const text = "Artificial intelligence and machine learning transform industries. " +
      "Deep learning neural networks process vast amounts of data efficiently.";
    const keywords = extractYakeKeywords(text, 10);

    for (const kw of keywords) {
      expect(kw.score).toBeGreaterThan(0);
      expect(Number.isFinite(kw.score)).toBe(true);
      expect(Number.isNaN(kw.score)).toBe(false);
    }
  });

  it("respects max n-gram size (no phrases longer than maxNgram)", () => {
    const text = "The quick brown fox jumps over the lazy dog repeatedly and consistently.";
    const keywords3 = extractYakeKeywords(text, 10, 3);
    for (const kw of keywords3) {
      const wordCount = kw.keyword.split(" ").length;
      expect(wordCount).toBeLessThanOrEqual(3);
    }

    const keywords1 = extractYakeKeywords(text, 10, 1);
    for (const kw of keywords1) {
      expect(kw.keyword.split(" ").length).toBe(1);
    }
  });

  it("no phrase starts or ends with a stopword", () => {
    const text = "The transformer architecture enables large language models to perform well. " +
      "LLMs use attention mechanisms for better token prediction across sequences.";
    const keywords = extractYakeKeywords(text, 10);
    const stopwords = new Set(["the", "a", "an", "is", "are", "was", "were", "to", "for", "in", "on", "and", "or", "of", "with"]);

    for (const kw of keywords) {
      const words = kw.keyword.split(" ");
      expect(stopwords.has(words[0])).toBe(false);
      expect(stopwords.has(words[words.length - 1])).toBe(false);
    }
  });

  it("returns at most N results", () => {
    const text = "Machine learning deep learning natural language processing computer vision " +
      "reinforcement learning neural networks transformers attention mechanisms.";
    const kw5 = extractYakeKeywords(text, 5);
    const kw10 = extractYakeKeywords(text, 10);
    expect(kw5.length).toBeLessThanOrEqual(5);
    expect(kw10.length).toBeLessThanOrEqual(10);
  });

  it("handles all-stopwords text gracefully", () => {
    const text = "The is a an and or but for with from to in on at by.";
    const keywords = extractYakeKeywords(text, 5);
    expect(keywords.length).toBeLessThanOrEqual(5);
  });

  it("extracts from real newsletter-style text", () => {
    const text = "Consumer AI is being absorbed by platforms. Enterprise AI converges around " +
      "a few vendors. Vertical AI is the third path. If consumer gets absorbed by " +
      "incumbents and enterprise consolidates around platforms, vertical AI carves " +
      "out domain-specific value. The APIs become commodities.";
    const keywords = extractYakeKeywords(text, 5);
    expect(keywords.length).toBeGreaterThan(0);

    // Should extract domain-relevant phrases, not generic words
    const names = keywords.map(k => k.keyword);
    const hasDomainTerm = names.some(n =>
      n.includes("vertical") || n.includes("consumer") || n.includes("enterprise") ||
      n.includes("platform") || n.includes("api")
    );
    expect(hasDomainTerm).toBe(true);
  });
});
