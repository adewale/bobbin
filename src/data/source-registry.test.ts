import { describe, expect, it } from "vitest";
import { describeSource, KNOWN_SOURCES } from "./source-registry";

describe("source registry", () => {
  it("does not trust the non-Komoroske field-notes doc as a known archive source", () => {
    const source = describeSource("1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0");

    expect(source).toBeNull();
    expect(KNOWN_SOURCES.some((entry) => entry.docId === "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0")).toBe(false);
  });

  it("rejects unknown sources instead of auto-describing them", () => {
    const source = describeSource("1aaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbb");

    expect(source).toBeNull();
  });
});
