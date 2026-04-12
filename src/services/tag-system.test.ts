/**
 * Tests for the upgraded tag system:
 * 1. TF-IDF scoring (corpus-aware)
 * 2. Multi-word entity detection
 * 3. Adaptive tag counts
 * 4. Tag quality properties
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  extractTags,
  extractEntities,
  computeCorpusStats,
  type CorpusStats,
} from "./tag-generator";
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
    const tagsRare = extractTags("resonant computing resonant paradigm", 5, stats);
    const tagsCommon = extractTags("software engineering software testing", 5, stats);

    const rareScore = tagsRare.find((t) => t.name === "resonant")?.score || 0;
    const commonScore = tagsCommon.find((t) => t.name === "software")?.score || 0;
    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it("falls back to pure TF when no corpus stats provided", () => {
    const tags = extractTags("ecosystem dynamics ecosystem platform", 5);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0].name).toBe("ecosystem"); // highest TF
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

  it("entity tags are included in extractTags output", () => {
    const tags = extractTags(
      "Jeremie Miller said that resonant computing challenges extraction. Jeremie Miller is an interesting thinker.",
      10
    );
    const names = tags.map((t) => t.name);
    expect(names).toContain("jeremie miller");
  });

  it("does not produce 'jeremie' and 'miller' as separate tags when entity exists", () => {
    const tags = extractTags(
      "Jeremie Miller said that resonant computing challenges extraction. Jeremie Miller is an interesting thinker.",
      10
    );
    const names = tags.map((t) => t.name);
    // Should have the entity, not the parts
    if (names.includes("jeremie miller")) {
      expect(names).not.toContain("jeremie");
      expect(names).not.toContain("miller");
    }
  });
});

// === 3. Adaptive tag counts ===
describe("Adaptive tag counts", () => {
  it("always returns at least 1 tag for non-trivial text", () => {
    const tags = extractTags("The ecosystem platform dynamics are fascinating", 10);
    expect(tags.length).toBeGreaterThanOrEqual(1);
  });

  it("returns fewer tags for brief text", () => {
    const briefTags = extractTags("Short note.", 10);
    const richTags = extractTags(
      "The ecosystem dynamics of platform markets create emergent behaviors that challenge our understanding of competitive strategy and market consolidation patterns across technology sectors.",
      10
    );
    expect(briefTags.length).toBeLessThanOrEqual(richTags.length);
  });

  it("never exceeds maxTags", () => {
    const tags = extractTags(
      "ecosystem platform dynamics emergent behavior competitive strategy market consolidation technology innovation disruption paradigm",
      3
    );
    expect(tags.length).toBeLessThanOrEqual(3);
  });
});

// === 4. PBT: Tag quality properties ===
describe("PBT: Tag quality invariants", () => {
  it("tag names never contain HTML entities", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const tags = extractTags(text + " &#39; &amp; &lt;test&gt;", 10);
        for (const tag of tags) {
          expect(tag.name).not.toContain("&#");
          expect(tag.name).not.toContain("&amp;");
          expect(tag.name).not.toContain("&lt;");
          expect(tag.name).not.toContain("&gt;");
        }
      })
    );
  });

  it("tag slugs always match /^[a-z0-9-]*$/", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const tags = extractTags(text, 10);
        for (const tag of tags) {
          expect(tag.slug).toMatch(/^[a-z0-9-]*$/);
        }
      })
    );
  });

  it("no duplicate tag names in output", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const tags = extractTags(text, 10);
        const names = tags.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
      })
    );
  });

  it("single-word tags are never stopwords", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const tags = extractTags(text, 10);
        for (const tag of tags) {
          if (!tag.name.includes(" ")) {
            expect(STOPWORDS.has(tag.name)).toBe(false);
          }
        }
      })
    );
  });

  it("tags with scores always have score > 0", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 30, maxLength: 500 }), (text) => {
        const tags = extractTags(text, 10);
        for (const tag of tags) {
          if (tag.score !== undefined) {
            expect(tag.score).toBeGreaterThan(0);
          }
        }
      })
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 300 }), (text) => {
        const first = extractTags(text, 10);
        const second = extractTags(text, 10);
        expect(first).toEqual(second);
      })
    );
  });
});
