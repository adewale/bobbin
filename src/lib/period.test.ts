import { describe, it, expect } from "vitest";
import {
  isWithinPeriod,
  parsePeriodPath,
  periodBounds,
  periodLabel,
  periodPath,
  previousPeriod,
} from "./period";

describe("periodBounds", () => {
  it("spans a full calendar year", () => {
    expect(periodBounds({ kind: "year", year: 2025 })).toEqual({
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });

  it("spans a 31-day month", () => {
    expect(periodBounds({ kind: "month", year: 2026, month: 1 })).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });

  it("spans a 30-day month", () => {
    expect(periodBounds({ kind: "month", year: 2026, month: 4 })).toEqual({
      start: "2026-04-01",
      end: "2026-04-30",
    });
  });

  it("spans February in a non-leap year", () => {
    expect(periodBounds({ kind: "month", year: 2025, month: 2 })).toEqual({
      start: "2025-02-01",
      end: "2025-02-28",
    });
  });

  it("spans February in a leap year", () => {
    expect(periodBounds({ kind: "month", year: 2024, month: 2 })).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
  });

  it("zero-pads single-digit months in bounds", () => {
    expect(periodBounds({ kind: "month", year: 2026, month: 3 }).start).toBe("2026-03-01");
  });
});

describe("previousPeriod", () => {
  it("steps back one year for a yearly period", () => {
    expect(previousPeriod({ kind: "year", year: 2026 })).toEqual({ kind: "year", year: 2025 });
  });

  it("steps back one month within a year", () => {
    expect(previousPeriod({ kind: "month", year: 2026, month: 4 })).toEqual({
      kind: "month", year: 2026, month: 3,
    });
  });

  it("steps back across the year boundary for January", () => {
    expect(previousPeriod({ kind: "month", year: 2026, month: 1 })).toEqual({
      kind: "month", year: 2025, month: 12,
    });
  });
});

describe("periodLabel", () => {
  it("labels years as the bare year", () => {
    expect(periodLabel({ kind: "year", year: 2026 })).toBe("2026");
  });

  it("labels months as Month Year", () => {
    expect(periodLabel({ kind: "month", year: 2026, month: 4 })).toBe("April 2026");
  });
});

describe("periodPath", () => {
  it("uses /summaries/YYYY for years", () => {
    expect(periodPath({ kind: "year", year: 2026 })).toBe("/summaries/2026");
  });

  it("uses /summaries/YYYY/M for months (no zero-padding)", () => {
    expect(periodPath({ kind: "month", year: 2026, month: 4 })).toBe("/summaries/2026/4");
  });
});

describe("parsePeriodPath", () => {
  it("parses a year-only path", () => {
    expect(parsePeriodPath("2026")).toEqual({ kind: "year", year: 2026 });
  });

  it("parses a year+month path", () => {
    expect(parsePeriodPath("2026", "4")).toEqual({ kind: "month", year: 2026, month: 4 });
  });

  it("accepts zero-padded month", () => {
    expect(parsePeriodPath("2026", "04")).toEqual({ kind: "month", year: 2026, month: 4 });
  });

  it("rejects non-numeric year", () => {
    expect(parsePeriodPath("nope")).toBeNull();
  });

  it("rejects out-of-range month", () => {
    expect(parsePeriodPath("2026", "13")).toBeNull();
    expect(parsePeriodPath("2026", "0")).toBeNull();
  });

  it("rejects implausible year", () => {
    expect(parsePeriodPath("99")).toBeNull();
    expect(parsePeriodPath("12345")).toBeNull();
  });

  it("rejects year strings that Number() would otherwise accept", () => {
    // These all coerce to a valid number via Number() but are not URL-shaped.
    // The route handler should treat them as 404s, not as 2026.
    expect(parsePeriodPath("2026.0")).toBeNull();
    expect(parsePeriodPath("2026 ")).toBeNull();
    expect(parsePeriodPath(" 2026")).toBeNull();
    expect(parsePeriodPath("2.026e3")).toBeNull();
    expect(parsePeriodPath("+2026")).toBeNull();
    expect(parsePeriodPath("-2026")).toBeNull();
    expect(parsePeriodPath("0x7E2")).toBeNull();
    expect(parsePeriodPath("")).toBeNull();
  });

  it("rejects month strings that Number() would otherwise accept", () => {
    expect(parsePeriodPath("2026", "4.0")).toBeNull();
    expect(parsePeriodPath("2026", " 4")).toBeNull();
    expect(parsePeriodPath("2026", "4 ")).toBeNull();
    expect(parsePeriodPath("2026", "+4")).toBeNull();
    expect(parsePeriodPath("2026", "-4")).toBeNull();
    expect(parsePeriodPath("2026", "")).toBeNull();
    expect(parsePeriodPath("2026", "4e0")).toBeNull();
  });

  it("round-trips through periodPath", () => {
    const original = { kind: "month" as const, year: 2026, month: 4 };
    const path = periodPath(original);
    const parts = path.split("/").slice(2); // strip leading "/summaries/"
    expect(parsePeriodPath(parts[0], parts[1])).toEqual(original);
  });
});

describe("isWithinPeriod", () => {
  it("includes both endpoints of a month", () => {
    const period = { kind: "month" as const, year: 2026, month: 4 };
    expect(isWithinPeriod("2026-04-01", period)).toBe(true);
    expect(isWithinPeriod("2026-04-30", period)).toBe(true);
  });

  it("excludes dates outside the month", () => {
    const period = { kind: "month" as const, year: 2026, month: 4 };
    expect(isWithinPeriod("2026-03-31", period)).toBe(false);
    expect(isWithinPeriod("2026-05-01", period)).toBe(false);
  });

  it("works for years", () => {
    const period = { kind: "year" as const, year: 2026 };
    expect(isWithinPeriod("2026-12-31", period)).toBe(true);
    expect(isWithinPeriod("2027-01-01", period)).toBe(false);
  });
});
