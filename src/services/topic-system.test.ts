/**
 * Tests for the upgraded topic system:
 * 1. TF-IDF scoring (corpus-aware)
 * 2. Multi-word entity detection
 * 3. Adaptive topic counts
 * 4. Topic quality properties
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  extractTopics,
  extractEntities,
  computeCorpusStats,
  type CorpusStats,
} from "./topic-extractor";
import { STOPWORDS } from "../lib/text";

// === 1. TF-IDF scoring ===
describe("TF-IDF scoring", () => {
  const corpus = [
    "LLMs are transforming software development. LLMs enable new paradigms.",
    "Platform ecosystems evolve through competition. Ecosystem dynamics matter.",
    "Software quality depends on testing. Software engineering is changing.",
    "Resonant computing challenges the dominant paradigm of extraction.",
    "LLMs and software are discussed everywhere in tech circles today.",
  ];
  const stats = computeCorpusStats(corpus);

  it("computeCorpusStats returns correct total and doc frequencies", () => {
    expect(stats.totalChunks).toBe(5);
    // "llms" appears in chunks 0, 4 = 2 docs
    expect(stats.docFreq.get("llms")).toBe(2);
    // "software" appears in chunks 0, 2, 4 = 3 docs
    expect(stats.docFreq.get("software")).toBe(3);
    // "resonant" appears in chunk 3 only = 1 doc
    expect(stats.docFreq.get("resonant")).toBe(1);
  });

  it("rare terms score higher than common terms with same TF", () => {
    // "resonant" (1 doc) should score higher than "software" (3 docs) when TF is equal
    const topicsRare = extractTopics("resonant computing resonant paradigm", 5, stats);
    const topicsCommon = extractTopics("software engineering software testing", 5, stats);

    const rareScore = topicsRare.find((t) => t.name === "resonant")?.score || 0;
    const commonScore = topicsCommon.find((t) => t.name === "software")?.score || 0;
    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it("falls back to pure TF when no corpus stats provided", () => {
    const topics = extractTopics("ecosystem dynamics ecosystem platform", 5);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0].name).toBe("ecosystem"); // highest TF
  });
});

// === 2. Multi-word entity detection ===
describe("Multi-word entity detection", () => {
  it("detects capitalized multi-word names", () => {
    const entities = extractEntities(
      "Jeremie Miller said that Claude Code is transforming how we build software."
    );
    const names = entities.map((e) => e.name);
    expect(names).toContain("jeremie miller");
    expect(names).toContain("claude code");
  });

  it("does not treat sentence-start capitalization as entities", () => {
    const entities = extractEntities(
      "The market is growing. Many companies are adapting. Some will fail."
    );
    const names = entities.map((e) => e.name);
    expect(names).not.toContain("The market");
    expect(names).not.toContain("Many companies");
    expect(names).not.toContain("Some will");
  });

  it("detects product and company names", () => {
    const entities = extractEntities(
      "OpenAI released ChatGPT and it changed everything. Meta acquired Gizmo."
    );
    const names = entities.map((e) => e.name);
    expect(names).toContain("chatgpt");
    expect(names).toContain("openai");
  });

  it("entity topics are included in extractTopics output", () => {
    const topics = extractTopics(
      "Jeremie Miller said that resonant computing challenges extraction. Jeremie Miller is an interesting thinker.",
      10
    );
    const names = topics.map((t) => t.name);
    expect(names).toContain("jeremie miller");
  });

  it("does not produce 'jeremie' and 'miller' as separate topics when entity exists", () => {
    const topics = extractTopics(
      "Jeremie Miller said that resonant computing challenges extraction. Jeremie Miller is an interesting thinker.",
      10
    );
    const names = topics.map((t) => t.name);
    // Should have the entity, not the parts
    if (names.includes("jeremie miller")) {
      expect(names).not.toContain("jeremie");
      expect(names).not.toContain("miller");
    }
  });
});

// === 3. Adaptive topic counts ===
describe("Adaptive topic counts", () => {
  it("always returns at least 1 topic for non-trivial text", () => {
    const topics = extractTopics("The ecosystem platform dynamics are fascinating", 10);
    expect(topics.length).toBeGreaterThanOrEqual(1);
  });

  it("returns fewer topics for brief text", () => {
    const briefTopics = extractTopics("Short note.", 10);
    const richTopics = extractTopics(
      "The ecosystem dynamics of platform markets create emergent behaviors that challenge our understanding of competitive strategy and market consolidation patterns across technology sectors.",
      10
    );
    expect(briefTopics.length).toBeLessThanOrEqual(richTopics.length);
  });

  it("never exceeds maxTopics", () => {
    const topics = extractTopics(
      "ecosystem platform dynamics emergent behavior competitive strategy market consolidation technology innovation disruption paradigm",
      3
    );
    expect(topics.length).toBeLessThanOrEqual(3);
  });
});

// === 4. PBT: Topic quality properties ===
describe("PBT: Topic quality invariants", () => {
  it("topic names never contain HTML entities", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const topics = extractTopics(text + " &#39; &amp; &lt;test&gt;", 10);
        for (const topic of topics) {
          expect(topic.name).not.toContain("&#");
          expect(topic.name).not.toContain("&amp;");
          expect(topic.name).not.toContain("&lt;");
          expect(topic.name).not.toContain("&gt;");
        }
      })
    );
  });

  it("topic slugs always match /^[a-z0-9-]*$/", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const topics = extractTopics(text, 10);
        for (const topic of topics) {
          expect(topic.slug).toMatch(/^[a-z0-9-]*$/);
        }
      })
    );
  });

  it("no duplicate topic names in output", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const topics = extractTopics(text, 10);
        const names = topics.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
      })
    );
  });

  it("single-word topics are never stopwords", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const topics = extractTopics(text, 10);
        for (const topic of topics) {
          if (!topic.name.includes(" ")) {
            expect(STOPWORDS.has(topic.name)).toBe(false);
          }
        }
      })
    );
  });

  it("topics with scores always have score > 0", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 30, maxLength: 500 }), (text) => {
        const topics = extractTopics(text, 10);
        for (const topic of topics) {
          if (topic.score !== undefined) {
            expect(topic.score).toBeGreaterThan(0);
          }
        }
      })
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 300 }), (text) => {
        const first = extractTopics(text, 10);
        const second = extractTopics(text, 10);
        expect(first).toEqual(second);
      })
    );
  });
});
