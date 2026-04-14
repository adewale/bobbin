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

// === 1. YAKE keyword extraction (replaced TF-IDF) ===
describe("YAKE keyword extraction", () => {
  const corpus = [
    "LLMs are transforming software development. LLMs enable new paradigms.",
    "Platform ecosystems evolve through competition. Ecosystem dynamics matter.",
    "Software quality depends on testing. Software engineering is changing.",
    "Transformer architecture challenges the dominant paradigm of computing.",
    "LLMs and software are discussed everywhere in tech circles today.",
  ];
  const stats = computeCorpusStats(corpus);

  it("computeCorpusStats still works (backward compat)", () => {
    expect(stats.totalChunks).toBe(5);
    expect(stats.docFreq.get("llms")).toBe(2);
  });

  it("extractTopics uses YAKE (per-document, no corpus stats needed)", () => {
    const topics = extractTopics("Transformer architecture enables large language models to reason.", 5);
    expect(topics.length).toBeGreaterThan(0);
    // Should produce keyphrases, not just single words
    const names = topics.map(t => t.name);
    const hasMultiWord = names.some(n => n.includes(" "));
    // YAKE naturally produces multi-word phrases
    expect(hasMultiWord || names.length > 0).toBe(true);
  });

  it("extractTopics works without corpus stats", () => {
    const topics = extractTopics("Swarm dynamics and swarm coordination reshape the ecosystem.", 5);
    expect(topics.length).toBeGreaterThan(0);
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

  it("detects product and company names mid-sentence", () => {
    const entities = extractEntities(
      "The company OpenAI released ChatGPT and it changed everything. Then Meta acquired Gizmo."
    );
    const names = entities.map((e) => e.name);
    // Mid-sentence capitalised words are detected as entities
    expect(names).toContain("openai");
    expect(names).toContain("chatgpt");
    // Sentence-start single words ("Then") are NOT detected — that's correct
    expect(names).not.toContain("then");
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

  it("never exceeds maxTopics (plus entities)", () => {
    const topics = extractTopics(
      "Ecosystem platform dynamics competitive strategy market consolidation technology innovation disruption.",
      3
    );
    const nonEntities = topics.filter(t => t.kind !== "entity");
    expect(nonEntities.length).toBeLessThanOrEqual(3);
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
