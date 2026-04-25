import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { chunkForSqlBindings } from "../lib/db";

describe("chunkForSqlBindings", () => {
  it("preserves order while keeping every SQL batch under the configured cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10_000 }), { maxLength: 250 }),
        fc.integer({ min: 1, max: 25 }),
        (values, maxBindings) => {
          const chunks = chunkForSqlBindings(values, maxBindings);

          expect(chunks.flat()).toEqual(values);
          expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= maxBindings)).toBe(true);
          expect(chunks.length).toBe(Math.ceil(values.length / maxBindings));
        },
      ),
    );
  });

  it("rejects non-positive SQL batch sizes", () => {
    expect(() => chunkForSqlBindings([1, 2, 3], 0)).toThrow("maxBindings must be positive");
    expect(() => chunkForSqlBindings([1, 2, 3], -1)).toThrow("maxBindings must be positive");
  });
});
