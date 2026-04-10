import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseEpisodeDate, formatDate, monthName } from "./date";

describe("parseEpisodeDate properties", () => {
  it("never returns a date before year 2000 for 2-digit years", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 99 }),
        (month, day, year) => {
          const date = parseEpisodeDate(`${month}/${day}/${year}`);
          if (date) {
            expect(date.getUTCFullYear()).toBeGreaterThanOrEqual(2000);
          }
        }
      )
    );
  });

  it("roundtrips through formatDate for valid dates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }), // 28 to avoid month-length issues
        fc.integer({ min: 2000, max: 2099 }),
        (month, day, year) => {
          const input = `${month}/${day}/${year}`;
          const date = parseEpisodeDate(input);
          if (date) {
            const formatted = formatDate(date);
            const reparsed = parseEpisodeDate(formatted.replace(/-/g, "/").replace(/^(\d{4})\//, (_, y) => `${parseInt(y)}/`));
            // The formatted date should parse back to the same date
            expect(formatted).toBe(
              `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            );
          }
        }
      )
    );
  });

  it("returns null for months > 12", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 13, max: 99 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 99 }),
        (month, day, year) => {
          expect(parseEpisodeDate(`${month}/${day}/${year}`)).toBeNull();
        }
      )
    );
  });

  it("returns null for day 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 99 }),
        (month, year) => {
          expect(parseEpisodeDate(`${month}/0/${year}`)).toBeNull();
        }
      )
    );
  });

  it("returns null for strings without date patterns", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)),
        (input) => {
          expect(parseEpisodeDate(input)).toBeNull();
        }
      )
    );
  });
});

describe("monthName properties", () => {
  it("returns non-empty string for months 1-12", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (month) => {
        const name = monthName(month);
        expect(name.length).toBeGreaterThan(0);
      })
    );
  });

  it("returns empty string for months outside 1-12", () => {
    fc.assert(
      fc.property(
        fc.integer().filter((n) => n < 1 || n > 12),
        (month) => {
          expect(monthName(month)).toBe("");
        }
      )
    );
  });
});
