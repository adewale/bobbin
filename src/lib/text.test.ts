import { describe, it, expect } from "vitest";
import { tokenize, countWords } from "./text";

describe("tokenize", () => {
  it("splits text into lowercase words", () => {
    const tokens = tokenize("The Quick Brown Fox Jumps");
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("jumps");
  });

  it("excludes stopwords", () => {
    const tokens = tokenize("The quick brown fox jumps over the lazy dog");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("over");
  });

  it("excludes short words (<=3 chars)", () => {
    const tokens = tokenize("I am a big fan of AI and LLM");
    expect(tokens).not.toContain("i");
    expect(tokens).not.toContain("am");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("big");
    expect(tokens).not.toContain("fan");
    expect(tokens).not.toContain("llm");
  });

  it("excludes common generic words", () => {
    const tokens = tokenize("People think good things are important and everyone knows time is something");
    expect(tokens).not.toContain("people");
    expect(tokens).not.toContain("good");
    expect(tokens).not.toContain("everyone");
    expect(tokens).not.toContain("something");
  });

  it("keeps domain-specific words", () => {
    const tokens = tokenize("The ecosystem platform dynamics create emergent behavior");
    expect(tokens).toContain("ecosystem");
    expect(tokens).toContain("platform");
    expect(tokens).toContain("dynamics");
    expect(tokens).toContain("emergent");
    expect(tokens).toContain("behavior");
  });
});

describe("countWords", () => {
  it("counts words in text", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("handles empty string", () => {
    expect(countWords("")).toBe(0);
  });
});
