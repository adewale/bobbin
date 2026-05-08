import { describe, expect, it } from "vitest";
import { isTuesdayNineAmLondon } from "./london-cron";

describe("isTuesdayNineAmLondon", () => {
  it("matches 09:00 UTC during winter time", () => {
    expect(isTuesdayNineAmLondon(Date.parse("2026-01-06T09:00:00.000Z"))).toBe(true);
    expect(isTuesdayNineAmLondon(Date.parse("2026-01-06T08:00:00.000Z"))).toBe(false);
  });

  it("matches 08:00 UTC during summer time", () => {
    expect(isTuesdayNineAmLondon(Date.parse("2026-07-07T08:00:00.000Z"))).toBe(true);
    expect(isTuesdayNineAmLondon(Date.parse("2026-07-07T09:00:00.000Z"))).toBe(false);
  });

  it("rejects non-Tuesday times even if the hour is 09 in London", () => {
    expect(isTuesdayNineAmLondon(Date.parse("2026-01-07T09:00:00.000Z"))).toBe(false);
  });
});
