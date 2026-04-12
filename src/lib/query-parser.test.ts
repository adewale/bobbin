import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseSearchQuery, type ParsedQuery } from "./query-parser";

describe("parseSearchQuery", () => {
  it("returns plain text when no operators", () => {
    const q = parseSearchQuery("ecosystem dynamics");
    expect(q.text).toBe("ecosystem dynamics");
    expect(q.before).toBeUndefined();
    expect(q.after).toBeUndefined();
    expect(q.year).toBeUndefined();
    expect(q.phrases).toHaveLength(0);
  });

  it("extracts before: operator", () => {
    const q = parseSearchQuery("llms before:2025-06-01");
    expect(q.text).toBe("llms");
    expect(q.before).toBe("2025-06-01");
  });

  it("extracts after: operator", () => {
    const q = parseSearchQuery("agents after:2024-01-01");
    expect(q.text).toBe("agents");
    expect(q.after).toBe("2024-01-01");
  });

  it("extracts year: operator", () => {
    const q = parseSearchQuery("software year:2025");
    expect(q.text).toBe("software");
    expect(q.year).toBe(2025);
  });

  it("extracts exact phrases in double quotes", () => {
    const q = parseSearchQuery('"cognitive labor" in the age of AI');
    expect(q.phrases).toEqual(["cognitive labor"]);
    expect(q.text).toBe("in the age of AI");
  });

  it("handles multiple operators", () => {
    const q = parseSearchQuery('"resonant computing" year:2025 after:2025-06-01');
    expect(q.phrases).toEqual(["resonant computing"]);
    expect(q.year).toBe(2025);
    expect(q.after).toBe("2025-06-01");
    expect(q.text).toBe("");
  });

  it("handles multiple exact phrases", () => {
    const q = parseSearchQuery('"claude code" "prompt injection"');
    expect(q.phrases).toContain("claude code");
    expect(q.phrases).toContain("prompt injection");
  });

  it("trims whitespace from remaining text", () => {
    const q = parseSearchQuery("  llms  year:2025  ");
    expect(q.text).toBe("llms");
  });

  it("handles empty query", () => {
    const q = parseSearchQuery("");
    expect(q.text).toBe("");
    expect(q.phrases).toHaveLength(0);
  });
});

describe("PBT: parseSearchQuery invariants", () => {
  it("never loses the year value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2030 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (year, text) => {
          const q = parseSearchQuery(`${text} year:${year}`);
          expect(q.year).toBe(year);
        }
      )
    );
  });

  it("operators are always removed from text", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('"') && !s.includes(':')),
        (text) => {
          const q = parseSearchQuery(`${text} year:2025 before:2025-01-01`);
          expect(q.text).not.toContain("year:");
          expect(q.text).not.toContain("before:");
        }
      )
    );
  });

  it("output text is always trimmed", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (input) => {
        const q = parseSearchQuery(input);
        expect(q.text).toBe(q.text.trim());
      })
    );
  });
});
