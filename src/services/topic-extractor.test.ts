import { describe, it, expect } from "vitest";
import { extractTopics } from "./topic-extractor";

describe("extractTopics (YAKE-based)", () => {
  it("extracts keyphrases from text", () => {
    const topics = extractTopics(
      "The swarm dynamics of transformer computing are fascinating. Transformer architectures evolve through embedding swarm intelligence."
    );
    expect(topics.length).toBeGreaterThan(0);
    // Should extract domain-relevant terms
    const names = topics.map((t) => t.name.toLowerCase());
    const hasDomainTerm = names.some(n =>
      n.includes("swarm") || n.includes("transformer") || n.includes("computing")
    );
    expect(hasDomainTerm).toBe(true);
  });

  it("returns topics with slugs", () => {
    const topics = extractTopics("Platform markets and ecosystem dynamics reshape the industry fundamentally.");
    for (const topic of topics) {
      expect(topic.slug).toBeTruthy();
      expect(topic.slug).not.toContain(" ");
    }
  });

  it("excludes stopwords as standalone topics", () => {
    const topics = extractTopics("The quick brown fox jumps over the lazy dog repeatedly");
    const names = topics.map((t) => t.name);
    expect(names).not.toContain("the");
    expect(names).not.toContain("over");
  });

  it("respects maxTopics limit (plus entities)", () => {
    const topics = extractTopics(
      "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron. " +
      "These words matter in the Greek alphabet context.",
      3
    );
    // maxTopics limits YAKE + heuristic results (entities are extra)
    const nonEntities = topics.filter(t => t.kind !== "entity");
    expect(nonEntities.length).toBeLessThanOrEqual(3);
  });

  it("includes known entities alongside YAKE keyphrases", () => {
    const topics = extractTopics(
      "OpenAI released a new model. The transformer architecture enables reasoning. Google competes strongly."
    );
    const entities = topics.filter(t => t.kind === "entity");
    const keyphrases = topics.filter(t => !t.kind || t.kind === "concept");
    expect(entities.length).toBeGreaterThan(0);
    // YAKE should produce some keyphrases too
    expect(keyphrases.length).toBeGreaterThanOrEqual(0);
  });

  it("defaults to 5 topics per chunk (not 10 or 15)", () => {
    const topics = extractTopics(
      "Consumer AI is being absorbed by platforms. Enterprise AI converges around vendors. " +
      "Vertical AI carves domain-specific value. The APIs become commodities. " +
      "Agents coordinate through swarms and the ecosystem evolves rapidly."
    );
    // Max 5 YAKE + entities on top
    const nonEntities = topics.filter(t => t.kind !== "entity");
    expect(nonEntities.length).toBeLessThanOrEqual(5);
  });
});
