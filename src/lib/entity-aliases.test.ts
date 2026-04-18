import { describe, it, expect } from "vitest";
import { expandEntityAliases } from "./entity-aliases";
import { KNOWN_ENTITIES } from "../data/known-entities";

describe("expandEntityAliases", () => {
  it("returns all aliases when query matches an entity name", () => {
    const result = expandEntityAliases("OpenAI", KNOWN_ENTITIES);
    expect(result).toContain("openai");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns all aliases when query matches an alias", () => {
    const result = expandEntityAliases("stratechery", KNOWN_ENTITIES);
    expect(result).toContain("ben thompson");
    expect(result).toContain("stratechery");
  });

  it("is case insensitive", () => {
    const result = expandEntityAliases("OPENAI", KNOWN_ENTITIES);
    expect(result).toContain("openai");
  });

  it("returns empty array for unrecognized query", () => {
    const result = expandEntityAliases("quantum physics", KNOWN_ENTITIES);
    expect(result).toEqual([]);
  });

  it("matches entity name within a longer query", () => {
    const result = expandEntityAliases("news about OpenAI today", KNOWN_ENTITIES);
    expect(result).toContain("openai");
  });

  it("returns canonical name and aliases for Hacker News", () => {
    const result = expandEntityAliases("hn", KNOWN_ENTITIES);
    expect(result).toContain("hacker news");
    expect(result).toContain("hackernews");
    expect(result).toContain("hn");
  });

  it("treats Facebook as its own canonical entity, not as Meta", () => {
    const result = expandEntityAliases("facebook", KNOWN_ENTITIES);
    expect(result).toContain("facebook");
    expect(result).not.toContain("meta");
  });
});
