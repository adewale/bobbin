import { describe, it, expect } from "vitest";
import { findCrossReferences } from "./cross-refs";

describe("findCrossReferences", () => {
  it("identifies chunks with high similarity scores", () => {
    // Simulate Vectorize results
    const matches = [
      { id: "chunk-2024-01-15-0", score: 0.92, metadata: { chunkId: 1, title: "Ecosystem growth" } },
      { id: "chunk-2024-03-18-0", score: 0.88, metadata: { chunkId: 3, title: "Ecosystem decline" } },
      { id: "chunk-2024-02-12-1", score: 0.65, metadata: { chunkId: 5, title: "LLM thoughts" } },
      { id: "chunk-2024-01-15-1", score: 0.45, metadata: { chunkId: 2, title: "Platform markets" } },
    ];

    const refs = findCrossReferences(matches, "chunk-2024-04-08-0", 0.7);
    expect(refs).toHaveLength(2);
    expect(refs[0].title).toBe("Ecosystem growth");
    expect(refs[1].title).toBe("Ecosystem decline");
  });

  it("excludes the source chunk itself", () => {
    const matches = [
      { id: "chunk-self", score: 1.0, metadata: { chunkId: 99, title: "Self" } },
      { id: "chunk-other", score: 0.85, metadata: { chunkId: 1, title: "Other" } },
    ];
    const refs = findCrossReferences(matches, "chunk-self", 0.7);
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBe("Other");
  });

  it("returns empty when nothing exceeds threshold", () => {
    const matches = [
      { id: "chunk-1", score: 0.5, metadata: { chunkId: 1, title: "Low" } },
    ];
    const refs = findCrossReferences(matches, "chunk-self", 0.7);
    expect(refs).toHaveLength(0);
  });
});
