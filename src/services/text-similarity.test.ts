import { describe, it, expect } from "vitest";
import { diceCoefficient, simpleStem, clusterBySimilarity } from "./text-similarity";

describe("diceCoefficient", () => {
  it("returns 1.0 for identical strings", () => {
    expect(diceCoefficient("hello", "hello")).toBe(1.0);
  });

  it("returns 0.0 for completely different strings", () => {
    expect(diceCoefficient("abc", "xyz")).toBe(0.0);
  });

  it("returns high similarity for inflectional variants", () => {
    expect(diceCoefficient("chatbot", "chatbots")).toBeGreaterThan(0.8);
    expect(diceCoefficient("model", "models")).toBeGreaterThan(0.7);
    expect(diceCoefficient("computing", "computation")).toBeGreaterThan(0.5);
  });

  it("returns low similarity for unrelated words", () => {
    expect(diceCoefficient("transformer", "platform")).toBeLessThan(0.4);
  });

  it("is case insensitive", () => {
    expect(diceCoefficient("OpenAI", "openai")).toBe(1.0);
  });

  it("handles short strings", () => {
    expect(diceCoefficient("a", "b")).toBe(0.0);
    expect(diceCoefficient("a", "a")).toBe(1.0); // identical single chars
    expect(diceCoefficient("", "")).toBe(1.0);    // identical empty strings
    expect(diceCoefficient("", "abc")).toBe(0.0);
  });
});

describe("simpleStem", () => {
  it("removes plurals", () => {
    expect(simpleStem("chatbots")).toBe("chatbot");
    expect(simpleStem("models")).toBe("model");
    expect(simpleStem("companies")).toBe("company");
  });

  it("handles -ed", () => {
    expect(simpleStem("computed")).toBe("comput");
    expect(simpleStem("transformed")).toBe("transform");
  });

  it("handles -ing", () => {
    expect(simpleStem("computing")).toBe("comput");
    expect(simpleStem("running")).toBe("runn");
  });

  it("preserves short words", () => {
    expect(simpleStem("llm")).toBe("llm");
    expect(simpleStem("ai")).toBe("ai");
  });

  it("preserves words ending in -ss", () => {
    expect(simpleStem("process")).toBe("process");
  });
});

describe("clusterBySimilarity", () => {
  it("clusters inflectional variants together", () => {
    const clusters = clusterBySimilarity(["chatbot", "chatbots"], 0.7);
    // Both should map to the same representative
    expect(clusters.get("chatbot")).toBe(clusters.get("chatbots"));
  });

  it("keeps distinct topics separate", () => {
    const clusters = clusterBySimilarity(["transformer", "platform", "agent"], 0.7);
    expect(clusters.get("transformer")).toBe("transformer");
    expect(clusters.get("platform")).toBe("platform");
    expect(clusters.get("agent")).toBe("agent");
  });

  it("longer names become the representative", () => {
    const clusters = clusterBySimilarity(["machine learning", "machine learn"], 0.7);
    const rep = clusters.get("machine learn");
    // The longer "machine learning" should be the representative
    expect(rep).toBe("machine learning");
  });

  it("handles empty input", () => {
    const clusters = clusterBySimilarity([], 0.7);
    expect(clusters.size).toBe(0);
  });
});
