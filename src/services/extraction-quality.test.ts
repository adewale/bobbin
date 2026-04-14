/**
 * Tests for topic extraction quality, tuned against the local corpus.
 *
 * Empirical findings from scripts/analyze-topics.ts on 20 episodes (994 chunks):
 * - 65% of topics are singletons (appear in 1 chunk only) → wasted DB writes
 * - Top non-entity topics include garbage: "emergent", "moment", "resonant"
 * - Heuristic entities produce "mckeown' essentialism" (curly quote bug)
 * - 15 topics per chunk pushes noise into the system
 *
 * These tests encode the desired quality thresholds.
 */
import { describe, it, expect } from "vitest";
import { extractTopics, extractEntities } from "./topic-extractor";

describe("possessive curly quote handling", () => {
  it("does NOT produce entities with dangling curly quotes", () => {
    // \u2019 is the right single quotation mark (Google Docs apostrophe)
    const text = "I found myself coming back to McKeown\u2019s Essentialism. The focus was clear.";
    const entities = extractEntities(text);

    for (const e of entities) {
      // No dangling quote before space or at end
      expect(e.name).not.toMatch(/['\u2018\u2019]\s/);
      expect(e.name).not.toMatch(/['\u2018\u2019]$/);
    }
  });

  it("strips possessive suffix before entity extraction", () => {
    const text = "Then Karpathy\u2019s software model evolved. Ramp\u2019s March update was big.";
    const entities = extractEntities(text);
    const names = entities.map(e => e.name);

    expect(names).not.toContain("karpathy\u2019 software");
    expect(names).not.toContain("karpathy' software");
    expect(names).not.toContain("ramp\u2019 march");
    expect(names).not.toContain("ramp' march");
  });
});

describe("extractTopics respects reduced topic limit", () => {
  it("extracts at most 10 topics per chunk", () => {
    const text = "The emergent behavior of large language models continues to surprise researchers. " +
      "OpenAI released ChatGPT and the entire world changed dramatically. Google responded with Gemini quickly. " +
      "The resonant insight was that consumer AI is being absorbed by major platforms everywhere. " +
      "Enterprise AI converges around a few dominant vendors. The shift was dramatic and fast. " +
      "Personal software becomes possible through new tooling. Agents coordinate through swarms. " +
      "The authentic outcome was a collective realization about unprecedented scale and reach.";

    const topics = extractTopics(text);
    expect(topics.length).toBeLessThanOrEqual(10);
  });

  it("still includes entities within the limit", () => {
    const text = "OpenAI and Google and Anthropic compete. The LLM ecosystem evolves rapidly.";
    const topics = extractTopics(text);
    const entities = topics.filter(t => t.kind === "entity");
    expect(entities.length).toBeGreaterThan(0);
  });
});

describe("extractTopics filters garbage single words", () => {
  it("does not include common adjectives as topics", () => {
    const text = "The emergent resonant authentic collective personal experience was profound. " +
      "The emergent resonant patterns continued. Something authentic emerged from the collective.";
    const topics = extractTopics(text);
    const names = topics.map(t => t.name.toLowerCase());

    expect(names).not.toContain("emergent");
    expect(names).not.toContain("resonant");
    expect(names).not.toContain("authentic");
    expect(names).not.toContain("collective");
    expect(names).not.toContain("personal");
  });

  it("does not include common verbs as topics", () => {
    const text = "They realized and improved and shifted the outcome. " +
      "The team realized the magnitude. They improved the output significantly.";
    const topics = extractTopics(text);
    const names = topics.map(t => t.name.toLowerCase());

    expect(names).not.toContain("realize");
    expect(names).not.toContain("improve");
    expect(names).not.toContain("shift");
    expect(names).not.toContain("outcome");
    expect(names).not.toContain("magnitude");
  });
});
