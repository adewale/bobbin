import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeAndRerank, type ScoredResult } from "./search";

const scoredResultArb = (source: "fts" | "vector") =>
  fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    slug: fc.string({ minLength: 1, maxLength: 20 }),
    score: fc.double({ min: 0, max: 1, noNaN: true }),
    source: fc.constant(source),
  }) as fc.Arbitrary<ScoredResult>;

describe("mergeAndRerank properties", () => {
  it("output is always sorted descending by score", () => {
    fc.assert(
      fc.property(
        fc.array(scoredResultArb("fts"), { maxLength: 20 }),
        fc.array(scoredResultArb("vector"), { maxLength: 20 }),
        (fts, vec) => {
          const merged = mergeAndRerank(fts, vec);
          for (let i = 1; i < merged.length; i++) {
            expect(merged[i - 1].score).toBeGreaterThanOrEqual(merged[i].score);
          }
        }
      )
    );
  });

  it("no duplicate IDs in output", () => {
    fc.assert(
      fc.property(
        fc.array(scoredResultArb("fts"), { maxLength: 20 }),
        fc.array(scoredResultArb("vector"), { maxLength: 20 }),
        (fts, vec) => {
          const merged = mergeAndRerank(fts, vec);
          const ids = merged.map((r) => r.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      )
    );
  });

  it("every input ID appears in output", () => {
    fc.assert(
      fc.property(
        fc.array(scoredResultArb("fts"), { maxLength: 15 }),
        fc.array(scoredResultArb("vector"), { maxLength: 15 }),
        (fts, vec) => {
          const merged = mergeAndRerank(fts, vec);
          const outputIds = new Set(merged.map((r) => r.id));
          for (const r of fts) expect(outputIds.has(r.id)).toBe(true);
          for (const r of vec) expect(outputIds.has(r.id)).toBe(true);
        }
      )
    );
  });

  it("output length equals count of unique input IDs", () => {
    fc.assert(
      fc.property(
        fc.array(scoredResultArb("fts"), { maxLength: 15 }),
        fc.array(scoredResultArb("vector"), { maxLength: 15 }),
        (fts, vec) => {
          const merged = mergeAndRerank(fts, vec);
          const uniqueIds = new Set([...fts.map((r) => r.id), ...vec.map((r) => r.id)]);
          expect(merged.length).toBe(uniqueIds.size);
        }
      )
    );
  });

  it("items appearing in both sets score higher than FTS-only items with same FTS score", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        (ftsScore, vecScore) => {
          const fts: ScoredResult[] = [
            { id: 1, slug: "both", score: ftsScore, source: "fts" },
            { id: 2, slug: "fts-only", score: ftsScore, source: "fts" },
          ];
          const vec: ScoredResult[] = [
            { id: 1, slug: "both", score: vecScore, source: "vector" },
          ];
          const merged = mergeAndRerank(fts, vec);
          const bothItem = merged.find((r) => r.id === 1)!;
          const ftsOnlyItem = merged.find((r) => r.id === 2)!;
          // The item in both sets should score higher due to crossover bonus
          expect(bothItem.score).toBeGreaterThan(ftsOnlyItem.score);
        }
      )
    );
  });

  it("handles empty inputs", () => {
    expect(mergeAndRerank([], [])).toEqual([]);
  });
});
