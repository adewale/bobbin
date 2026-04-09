import { describe, it, expect } from "vitest";
import { parseEpisodeDate, formatDate, monthName } from "./date";

describe("parseEpisodeDate", () => {
  it("parses M/D/YY format", () => {
    const date = parseEpisodeDate("4/8/24");
    expect(date).not.toBeNull();
    expect(formatDate(date!)).toBe("2024-04-08");
  });

  it("parses M/D/YYYY format", () => {
    const date = parseEpisodeDate("12/15/2025");
    expect(date).not.toBeNull();
    expect(formatDate(date!)).toBe("2025-12-15");
  });

  it("parses single-digit month/day", () => {
    const date = parseEpisodeDate("1/2/25");
    expect(date).not.toBeNull();
    expect(formatDate(date!)).toBe("2025-01-02");
  });

  it("returns null for invalid date string", () => {
    expect(parseEpisodeDate("not a date")).toBeNull();
  });

  it("returns null for invalid date components", () => {
    expect(parseEpisodeDate("2/30/24")).toBeNull();
  });

  it("extracts date from text containing a date", () => {
    const date = parseEpisodeDate("Bits and Bobs 4/8/24");
    expect(date).not.toBeNull();
    expect(formatDate(date!)).toBe("2024-04-08");
  });
});

describe("monthName", () => {
  it("returns month name for valid month number", () => {
    expect(monthName(1)).toBe("January");
    expect(monthName(12)).toBe("December");
  });

  it("returns empty string for invalid month", () => {
    expect(monthName(0)).toBe("");
    expect(monthName(13)).toBe("");
  });
});
