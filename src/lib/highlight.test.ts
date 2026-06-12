import { describe, it, expect } from "vitest";
import { highlightInExcerpt } from "./highlight";


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
