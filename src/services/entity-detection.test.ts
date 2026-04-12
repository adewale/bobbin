import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  extractKnownEntities,
  identifyDistinctiveEntities,
  extractTopics,
} from "./topic-extractor";

describe("extractKnownEntities", () => {
  it("returns a topic for OpenAI when text mentions it", () => {
    const results = extractKnownEntities("OpenAI announced a new model today");
    const names = results.map((r) => r.name);
    expect(names).toContain("OpenAI");
  });

  it("returns Stratechery product entity when text mentions stratechery", () => {
    const results = extractKnownEntities(
      "I read an interesting post from Stratechery this week"
    );
    const names = results.map((r) => r.name);
    expect(names).toContain("Stratechery");
  });

  it("is case-insensitive", () => {
    const results = extractKnownEntities("OPENAI is doing great work");
    const names = results.map((r) => r.name);
    expect(names).toContain("OpenAI");
  });

  it("returns empty array when no entities are found", () => {
    const results = extractKnownEntities("no entities here");
    expect(results).toEqual([]);
  });

  it("returns results with valid slugs", () => {
    const results = extractKnownEntities("OpenAI and Google are competing");
    for (const result of results) {
      expect(result.slug).toBeTruthy();
      expect(result.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("deduplicates entities that match multiple aliases", () => {
    // "stratechery" is an alias for both Ben Thompson (person) and Stratechery (product)
    // Both should appear since they are different canonical entities
    const results = extractKnownEntities(
      "Stratechery had a great analysis"
    );
    const names = results.map((r) => r.name);
    // Stratechery matches Ben Thompson (via alias) and Stratechery (product)
    expect(names).toContain("Ben Thompson");
    expect(names).toContain("Stratechery");
  });

  it("does not return duplicate entries for the same entity", () => {
    const results = extractKnownEntities(
      "OpenAI released something. Then openai did more."
    );
    const openaiResults = results.filter((r) => r.name === "OpenAI");
    expect(openaiResults).toHaveLength(1);
  });
});

describe("extractTopics with known entities", () => {
  it("includes known entities even if TF-IDF would not surface them", () => {
    // OpenAI mentioned once in a long text — TF-IDF alone wouldn't rank it high
    const text =
      "The ecosystem dynamics of platform markets are fascinating. " +
      "Platform ecosystems evolve through ecosystem competition and platform strategies. " +
      "OpenAI recently joined the platform economy discussion. " +
      "Platform markets are growing rapidly through ecosystem dynamics.";
    const topics = extractTopics(text);
    const names = topics.map((t) => t.name);
    expect(names).toContain("OpenAI");
  });

  it("returns more than 5 topics when content is rich enough", () => {
    const text =
      "OpenAI announced a partnership with Microsoft to develop ChatGPT integrations. " +
      "Google responded with Gemini updates while Anthropic released Claude improvements. " +
      "Sam Altman discussed the future of artificial intelligence at a conference. " +
      "The ecosystem dynamics of platform markets continue to evolve. " +
      "Meta unveiled new research on large language models and agent architectures. " +
      "Simon Willison wrote about prompt injection vulnerabilities in modern systems. " +
      "Apple is exploring machine learning capabilities for their products. " +
      "Andrej Karpathy shared insights about neural network training techniques. " +
      "Amazon Web Services launched new cloud computing infrastructure services.";
    const topics = extractTopics(text);
    expect(topics.length).toBeGreaterThan(5);
  });
});

describe("identifyDistinctiveEntities", () => {
  it("promotes high-distinctiveness non-baseline words", () => {
    const wordStats = [
      { word: "stratechery", distinctiveness: 20, in_baseline: 0 },
      { word: "substack", distinctiveness: 18, in_baseline: 0 },
      { word: "vercel", distinctiveness: 16, in_baseline: 0 },
      { word: "the", distinctiveness: 0.1, in_baseline: 1 },
      { word: "code", distinctiveness: 12, in_baseline: 1 },
    ];
    const promoted = identifyDistinctiveEntities(wordStats);
    expect(promoted).toContain("stratechery");
    expect(promoted).toContain("substack");
    expect(promoted).toContain("vercel");
    expect(promoted).not.toContain("the");
    expect(promoted).not.toContain("code");
  });

  it("filters out short words", () => {
    const wordStats = [
      { word: "aws", distinctiveness: 25, in_baseline: 0 },
      { word: "openai", distinctiveness: 30, in_baseline: 0 },
    ];
    const promoted = identifyDistinctiveEntities(wordStats);
    expect(promoted).not.toContain("aws");
    expect(promoted).toContain("openai");
  });

  it("returns empty array when no words qualify", () => {
    const wordStats = [
      { word: "common", distinctiveness: 2, in_baseline: 1 },
      { word: "word", distinctiveness: 5, in_baseline: 1 },
    ];
    const promoted = identifyDistinctiveEntities(wordStats);
    expect(promoted).toEqual([]);
  });
});

describe("entity detection property-based tests", () => {
  it("extractKnownEntities never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 1000 }), (text) => {
        expect(() => extractKnownEntities(text)).not.toThrow();
      })
    );
  });

  it("extractTopics never returns more than maxTopics results", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 500 }),
        fc.integer({ min: 1, max: 20 }),
        (text, maxTopics) => {
          const topics = extractTopics(text, maxTopics);
          expect(topics.length).toBeLessThanOrEqual(maxTopics);
        }
      )
    );
  });
});
