import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { slugify } from "./slug";

describe("slugify properties", () => {
  it("output always matches /^[a-z0-9-]*$/", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = slugify(input);
        expect(result).toMatch(/^[a-z0-9-]*$/);
      })
    );
  });

  it("never starts or ends with a dash", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = slugify(input);
        if (result.length > 0) {
          expect(result[0]).not.toBe("-");
          expect(result[result.length - 1]).not.toBe("-");
        }
      })
    );
  });

  it("never contains consecutive dashes", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = slugify(input);
        expect(result).not.toContain("--");
      })
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const once = slugify(input);
        const twice = slugify(once);
        expect(twice).toBe(once);
      })
    );
  });

  it("empty input produces empty output", () => {
    expect(slugify("")).toBe("");
  });
});
