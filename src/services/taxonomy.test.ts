import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractEntities, extractTopics } from "./topic-extractor";

describe("extractEntities taxonomy", () => {
  it("returns kind='entity' for multi-word proper nouns like 'Simon Willison'", () => {
    const results = extractEntities("Simon Willison writes about LLMs");
    const simonResult = results.find(r => r.name.includes("simon willison"));
    expect(simonResult).toBeDefined();
    expect(simonResult!.kind).toBe("entity");
  });

  it("returns kind='entity' for single capitalized word 'OpenAI'", () => {
    const results = extractEntities("The company OpenAI released a new model today");
    const openaiResult = results.find(r => r.name === "openai");
    expect(openaiResult).toBeDefined();
    expect(openaiResult!.kind).toBe("entity");
  });

  it("never crashes on arbitrary input and always returns valid kind values", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 1000 }), (text) => {
        const results = extractEntities(text);
        expect(Array.isArray(results)).toBe(true);
        for (const r of results) {
          expect(r.kind).toBeDefined();
          expect(["entity", "concept", "phrase"]).toContain(r.kind);
        }
      })
    );
  });
});

describe("extractTopics taxonomy", () => {
  it("includes heuristic entities with kind='entity' in results", () => {
    // Use a name NOT in the known entities list so it relies on heuristic detection
    const text =
      "The company released a product. Rachel Rodriguez writes extensively about LLMs and AI topics. " +
      "Rachel Rodriguez also discusses prompt engineering and safety measures.";
    const topics = extractTopics(text);
    const rachelTopic = topics.find(t => t.name.includes("rachel rodriguez"));
    expect(rachelTopic).toBeDefined();
    expect(rachelTopic!.kind).toBe("entity");
  });

  it("multi-word heuristic entities get kind='entity', not 'concept'", () => {
    const text =
      "In this episode Jeremie Miller explains his approach to distributed systems. " +
      "Jeremie Miller has been working on this for years. " +
      "The architecture that Jeremie Miller designed is fascinating.";
    const topics = extractTopics(text);
    const entityTopics = topics.filter(
      t => t.name.includes("jeremie miller")
    );
    for (const t of entityTopics) {
      expect(t.kind).not.toBe("concept");
      expect(t.kind).toBe("entity");
    }
  });
});
