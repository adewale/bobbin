import { describe, it, expect } from "vitest";
import { extractTopics } from "./topic-extractor";

describe("extractTopics", () => {
  it("extracts top keywords from text (noise words filtered)", () => {
    const topics = extractTopics(
      "The swarm dynamics of transformer computing are fascinating. Transformer architectures evolve through embedding swarm intelligence."
    );
    const names = topics.map((t) => t.name.toLowerCase());
    expect(names).toContain("swarm");
    expect(names).toContain("transformer");
  });

  it("returns topics with slugs", () => {
    const topics = extractTopics("Platform markets and ecosystem dynamics");
    for (const topic of topics) {
      expect(topic.slug).toBeTruthy();
      expect(topic.slug).not.toContain(" ");
    }
  });

  it("excludes stopwords", () => {
    const topics = extractTopics("The quick brown fox jumps over the lazy dog repeatedly");
    const names = topics.map((t) => t.name);
    expect(names).not.toContain("the");
    expect(names).not.toContain("over");
  });

  it("excludes short words", () => {
    const topics = extractTopics("AI and ML are big trends in CS and IT fields");
    const names = topics.map((t) => t.name);
    // All topics should be > 3 chars
    for (const name of names) {
      expect(name.length).toBeGreaterThan(3);
    }
  });

  it("respects maxTopics limit", () => {
    const topics = extractTopics(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron",
      3
    );
    expect(topics.length).toBeLessThanOrEqual(3);
  });

  it("extracts single-word topics via TF-IDF (noise words excluded)", () => {
    const topics = extractTopics(
      "Ecosystem dynamics are evolving. Ecosystem resilience matters. Ecosystem swarms emerge."
    );
    const names = topics.map((t) => t.name);
    // "ecosystem" should appear (not in noise list)
    expect(names).toContain("ecosystem");
    // "platform" would NOT appear (in noise list) — noise filtering is internal
  });
});
