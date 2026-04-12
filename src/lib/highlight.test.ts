import { describe, it, expect } from "vitest";
import { extractKWIC, highlightInExcerpt } from "./highlight";

describe("extractKWIC", () => {
  it("returns left and right context around keyword", () => {
    const result = extractKWIC("Hello world foobar baz quux", "foobar");
    expect(result).not.toBeNull();
    expect(result!.left).toBe("Hello world ");
    expect(result!.right).toBe(" baz quux");
  });

  it("returns null when keyword is not in text", () => {
    const result = extractKWIC("Hello world baz quux", "foobar");
    expect(result).toBeNull();
  });

  it("handles keyword at start of text", () => {
    const result = extractKWIC("foobar baz quux", "foobar");
    expect(result).not.toBeNull();
    expect(result!.left).toBe("");
    expect(result!.right).toBe(" baz quux");
  });

  it("handles keyword at end of text", () => {
    const result = extractKWIC("Hello world foobar", "foobar");
    expect(result).not.toBeNull();
    expect(result!.left).toBe("Hello world ");
    expect(result!.right).toBe("");
  });
});

describe("highlightInExcerpt", () => {
  it("wraps keyword in <mark> tags", () => {
    const result = highlightInExcerpt("the ecosystem evolves", "ecosystem");
    expect(result).toContain("<mark>ecosystem</mark>");
  });

  it("is case-insensitive", () => {
    const result = highlightInExcerpt("the Ecosystem evolves", "ecosystem");
    expect(result).toContain("<mark>Ecosystem</mark>");
  });
});
