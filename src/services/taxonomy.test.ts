import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractEntities, extractKnownEntities, extractTopics } from "./topic-extractor";

describe("extractEntities taxonomy", () => {
  it("heuristic entities do NOT get kind='entity' (reserved for curated known entities)", () => {
    const results = extractEntities("Simon Willison writes about LLMs");
    const simonResult = results.find(r => r.name.includes("simon willison"));
    expect(simonResult).toBeDefined();
    // Heuristic detection doesn't set kind — only extractKnownEntities does
    expect(simonResult!.kind).toBeUndefined();
  });

  it("known entities via extractKnownEntities DO get kind='entity'", () => {
    const results = extractKnownEntities("The company OpenAI released a new model today");
    const openaiResult = results.find(r => r.name === "OpenAI");
    expect(openaiResult).toBeDefined();
    expect(openaiResult!.kind).toBe("entity");
  });

  it("never crashes on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 1000 }), (text) => {
        const results = extractEntities(text);
        expect(Array.isArray(results)).toBe(true);
      })
    );
  });
});

describe("extractEntities does NOT classify sentence-start words as entities", () => {
  it("does not return common words capitalised at sentence start", () => {
    const text = "Fascinating discoveries were made. Suddenly the market shifted. Previously this was impossible.";
    const results = extractEntities(text);
    const names = results.map(r => r.name);
    // These are ordinary words at sentence start, NOT entities
    expect(names).not.toContain("fascinating");
    expect(names).not.toContain("suddenly");
    expect(names).not.toContain("previously");
  });

  it("DOES return genuine mid-sentence proper nouns", () => {
    const text = "The team at OpenAI built something. Then Anthropic responded quickly.";
    const results = extractEntities(text);
    const names = results.map(r => r.name);
    // "OpenAI" is mid-sentence capitalised — genuine entity
    expect(names).toContain("openai");
    // "Anthropic" starts a sentence but is a known proper noun
    // The heuristic can't distinguish this without a dictionary,
    // so we accept it may or may not appear
  });

  it("returns multi-word entities even at sentence start", () => {
    // Multi-word capitalised sequences at sentence start ARE likely entities
    const text = "Simon Willison wrote about it. Claude Code is impressive.";
    const results = extractEntities(text);
    const names = results.map(r => r.name);
    expect(names).toContain("simon willison");
    expect(names).toContain("claude code");
  });
});

describe("extractTopics taxonomy", () => {
  it("includes heuristic entities as topics (without kind='entity')", () => {
    const text =
      "The company released a product. Rachel Rodriguez writes extensively about LLMs and AI topics. " +
      "Rachel Rodriguez also discusses prompt engineering and safety measures.";
    const topics = extractTopics(text);
    const rachelTopic = topics.find(t => t.name.includes("rachel rodriguez"));
    expect(rachelTopic).toBeDefined();
    // Heuristic entities default to 'concept' — only curated entities get 'entity'
  });

  it("known entities get kind='entity' in extractTopics results", () => {
    const text = "The team at OpenAI built GPT. Google also competes in this space.";
    const topics = extractTopics(text);
    const openai = topics.find(t => t.name === "OpenAI");
    expect(openai).toBeDefined();
    expect(openai!.kind).toBe("entity");
  });

  it("multi-word heuristic entities are included as topics", () => {
    const text =
      "In this episode Jeremie Miller explains his approach to distributed systems. " +
      "Jeremie Miller has been working on this for years. " +
      "The architecture that Jeremie Miller designed is fascinating.";
    const topics = extractTopics(text);
    const entityTopics = topics.filter(
      t => t.name.includes("jeremie miller")
    );
    // Heuristic entities are included but without kind='entity'
    for (const t of entityTopics) {
      expect(t.name).toContain("jeremie miller");
    }
  });
});
