import { describe, it, expect } from "vitest";
import { diceCoefficient, simpleStem } from "./text-similarity";

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

