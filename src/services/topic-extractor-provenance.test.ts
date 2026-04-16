import { describe, it, expect } from "vitest";
import {
  extractKnownEntityCandidates,
  extractHeuristicEntityCandidates,
  normalizeChunkText,
} from "./topic-extractor";

describe("boundary-aware known entity matching", () => {
  it("does not match known entities inside larger words", () => {
    expect(extractKnownEntityCandidates(normalizeChunkText("the metaphor matters"), 1)).toEqual([]);
    expect(extractKnownEntityCandidates(normalizeChunkText("openair ships soon"), 1)).toEqual([]);
  });

  it("still matches full-token mentions", () => {
    const results = extractKnownEntityCandidates(normalizeChunkText("Meta and OpenAI shipped updates."), 1);
    expect(results.map((r) => r.name)).toContain("Meta");
    expect(results.map((r) => r.name)).toContain("OpenAI");
  });
});

describe("heuristic entity provenance", () => {
  it("logs why a heuristic entity was emitted", () => {
    const results = extractHeuristicEntityCandidates(
      normalizeChunkText("Simon Willison wrote about it. Then Claude Code shipped."),
      42
    );

    const simon = results.find((candidate) => candidate.normalizedCandidate === "simon willison");
    expect(simon).toBeDefined();
    expect(simon!.source).toBe("heuristic_entity");
    expect(simon!.provenance).toContain("sentence_start_multiword");
  });
});
