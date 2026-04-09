import { describe, it, expect } from "vitest";
import { tokenize, stripToPlainText, countWords } from "./text";

describe("tokenize", () => {
  it("splits text into lowercase words", () => {
    const tokens = tokenize("The Quick Brown Fox");
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("fox");
  });

  it("excludes stopwords", () => {
    const tokens = tokenize("The quick brown fox jumps over the lazy dog");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("over");
  });

  it("excludes short words (<=2 chars)", () => {
    const tokens = tokenize("I am a big fan of AI");
    expect(tokens).not.toContain("i");
    expect(tokens).not.toContain("am");
    expect(tokens).not.toContain("a");
  });

  it("handles punctuation", () => {
    const tokens = tokenize("Hello, world! It's a test.");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("it's");
    expect(tokens).toContain("test");
  });
});

describe("stripToPlainText", () => {
  it("removes HTML tags", () => {
    expect(stripToPlainText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("collapses whitespace", () => {
    expect(stripToPlainText("  hello   world  ")).toBe("hello world");
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
