import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { curateTopics, isNoiseTopic } from "./topic-quality";

function makeTopic(name: string, usage_count: number, distinctiveness = 1) {
  return {
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    usage_count,
    distinctiveness,
  };
}

describe("curateTopics", () => {
  it("removes 'harder' from topic list", () => {
    const topics = [
      makeTopic("harder", 10),
      makeTopic("llms", 20),
    ];
    const result = curateTopics(topics, []);
    const names = result.map(t => t.name);
    expect(names).not.toContain("harder");
    expect(names).toContain("llms");
  });

  it("removes 'apps' from topic list", () => {
    const topics = [
      makeTopic("apps", 10),
      makeTopic("llms", 20),
    ];
    const result = curateTopics(topics, []);
    const names = result.map(t => t.name);
    expect(names).not.toContain("apps");
  });

  it("keeps 'llms' (not in noise list, high usage)", () => {
    const topics = [makeTopic("llms", 50, 10)];
    const result = curateTopics(topics, []);
    const names = result.map(t => t.name);
    expect(names).toContain("llms");
  });

  it("suppresses 'coding' when 'vibe coding' has >= 40% of its usage", () => {
    const topics = [
      makeTopic("coding", 10),
      makeTopic("vibe coding", 5),
    ];
    const phraseTopics = [{ name: "vibe coding", usage_count: 5 }];
    const result = curateTopics(topics, phraseTopics);
    const names = result.map(t => t.name);
    expect(names).not.toContain("coding");
    expect(names).toContain("vibe coding");
  });

  it("keeps a non-noise word when no phrase subsumes it significantly", () => {
    const topics = [
      makeTopic("ecosystem", 100),
      makeTopic("platform ecosystem", 5),
    ];
    // platform ecosystem has only 5 usage, ecosystem has 100 => 5/100 = 5% < 40%
    const phraseTopics = [{ name: "platform ecosystem", usage_count: 5 }];
    const result = curateTopics(topics, phraseTopics);
    const names = result.map(t => t.name);
    expect(names).toContain("ecosystem");
  });

  it("keeps multi-word topics like 'claude code'", () => {
    const topics = [makeTopic("claude code", 15, 5)];
    const result = curateTopics(topics, []);
    const names = result.map(t => t.name);
    expect(names).toContain("claude code");
  });

  it("never returns more topics than it receives (PBT)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z]{4,12}$/),
            slug: fc.stringMatching(/^[a-z]{4,12}$/),
            usage_count: fc.integer({ min: 1, max: 100 }),
            distinctiveness: fc.float({ min: 0, max: 50, noNaN: true }),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (topics) => {
          const result = curateTopics(topics, []);
          expect(result.length).toBeLessThanOrEqual(topics.length);
        }
      )
    );
  });
});

describe("isNoiseTopic", () => {
  it("returns true for newly added noise word 'game'", () => {
    expect(isNoiseTopic("game")).toBe(true);
  });

  it("returns true for newly added verb 'asked'", () => {
    expect(isNoiseTopic("asked")).toBe(true);
  });

  it("returns true for empirically-identified garbage word 'resonant'", () => {
    // Found by scripts/analyze-topics.ts: "resonant" appeared 24 times
    // in top 50 but is not navigational
    expect(isNoiseTopic("resonant")).toBe(true);
  });

  it("returns true for other empirically-identified garbage", () => {
    // Top garbage from analyze-topics.ts run on 20 episodes
    const garbage = [
      "emergent", "moment", "outcome", "personal", "insight",
      "realize", "collective", "magnitude", "authentic", "resonance",
      "shift", "piece", "mind", "talk", "improve", "tend",
      "ever", "least", "ones", "live", "second", "term",
      "control", "story", "benefit", "output", "negative",
      "preference", "aspiration", "nuance", "tendency",
    ];
    for (const word of garbage) {
      expect(isNoiseTopic(word), `"${word}" should be noise`).toBe(true);
    }
  });

  it("returns false for domain-relevant words", () => {
    const good = ["llms", "chatbot", "swarm", "prompt", "agent", "coordination", "embedding"];
    for (const word of good) {
      expect(isNoiseTopic(word), `"${word}" should NOT be noise`).toBe(false);
    }
  });

  it("returns false for phrase topics like 'prompt injection'", () => {
    expect(isNoiseTopic("prompt injection")).toBe(false);
  });

  it("catches -ly adverbs via suffix heuristic", () => {
    expect(isNoiseTopic("extremely")).toBe(true);
    expect(isNoiseTopic("quickly")).toBe(true);
    expect(isNoiseTopic("typically")).toBe(true);
    expect(isNoiseTopic("deeply")).toBe(true);
  });

  it("catches short -ize verbs but not domain terms", () => {
    expect(isNoiseTopic("realize")).toBe(true);
    expect(isNoiseTopic("optimize")).toBe(true);
    // Domain terms (>9 chars) are allowed
    expect(isNoiseTopic("containerize")).toBe(false);
    expect(isNoiseTopic("vectorize")).toBe(false);
  });

  it("catches -ment nouns but not long domain terms", () => {
    expect(isNoiseTopic("moment")).toBe(true);
    expect(isNoiseTopic("argument")).toBe(true);
    // Long -ment words (>9 chars) are allowed
    expect(isNoiseTopic("deployment")).toBe(false);
    expect(isNoiseTopic("environment")).toBe(true); // in NOISE_WORDS explicitly
  });

  it("never crashes on arbitrary input and always returns boolean (PBT)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (name) => {
        const result = isNoiseTopic(name);
        expect(typeof result).toBe("boolean");
      })
    );
  });
});
