import { describe, it, expect } from "vitest";
import { extractTags } from "./tag-generator";

describe("extractTags", () => {
  it("extracts top keywords from text", () => {
    const tags = extractTags(
      "The ecosystem dynamics of platform markets are fascinating. Platform ecosystems evolve through ecosystem competition and platform strategies."
    );
    const names = tags.map((t) => t.name);
    expect(names).toContain("ecosystem");
    expect(names).toContain("platform");
  });

  it("returns tags with slugs", () => {
    const tags = extractTags("Platform markets and ecosystem dynamics");
    for (const tag of tags) {
      expect(tag.slug).toBeTruthy();
      expect(tag.slug).not.toContain(" ");
    }
  });

  it("excludes stopwords", () => {
    const tags = extractTags("The quick brown fox jumps over the lazy dog repeatedly");
    const names = tags.map((t) => t.name);
    expect(names).not.toContain("the");
    expect(names).not.toContain("over");
  });

  it("excludes short words", () => {
    const tags = extractTags("AI and ML are big trends in CS and IT fields");
    const names = tags.map((t) => t.name);
    // All tags should be > 3 chars
    for (const name of names) {
      expect(name.length).toBeGreaterThan(3);
    }
  });

  it("respects maxTags limit", () => {
    const tags = extractTags(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron",
      3
    );
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it("detects repeated bigrams", () => {
    const tags = extractTags(
      "platform markets are growing. platform markets will expand. platform markets dominate. platform markets lead."
    );
    const names = tags.map((t) => t.name);
    expect(names).toContain("platform markets");
  });
});
