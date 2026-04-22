import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildTerminologyDrift } from "./topic-detail";

describe("buildTerminologyDrift", () => {
  it("separates earlier and later framing phrases while excluding the topic token itself", () => {
    const drift = buildTerminologyDrift(
      [
        { content_plain: "LLMs use agent loops for complex tasks. Agent loops create planning pressure." },
        { content_plain: "LLMs and agent loops benefit from eval harnesses. Agent loops help tool orchestration." },
        { content_plain: "Security workflows now shape llms in practice. Security workflows require prompt defense." },
        { content_plain: "Security workflows became the later pattern for llms. Security workflows changed team habits." },
      ],
      "llms"
    );

    expect(drift.earlier.length).toBeGreaterThan(0);
    expect(drift.later.length).toBeGreaterThan(0);
    expect(drift.earlier.map((term) => term.phrase)).toContain("agent loops");
    expect(drift.later.map((term) => term.phrase)).toContain("security workflows");
    expect(drift.earlier.map((term) => term.phrase)).not.toContain("llms");
    expect(drift.later.map((term) => term.phrase)).not.toContain("llms");
    expect(drift.earlier.every((term) => term.delta < 0)).toBe(true);
    expect(drift.later.every((term) => term.delta > 0)).toBe(true);
    expect(drift.earlier.every((term) => term.phrase.includes(" "))).toBe(true);
    expect(drift.later.every((term) => term.phrase.includes(" "))).toBe(true);
    expect(drift.earlier.some((term) => drift.later.some((later) => later.phrase === term.phrase))).toBe(false);
  });

  it("never emits the topic token as part of any phrase for arbitrary chunk text", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 2, maxLength: 8 }),
        (texts) => {
          const drift = buildTerminologyDrift(
            texts.map((content_plain) => ({ content_plain })),
            "claude"
          );

          for (const term of [...drift.earlier, ...drift.later]) {
            expect(term.phrase.toLowerCase()).not.toContain("claude");
            expect(term.phrase.split(" ").length).toBeGreaterThan(1);
          }
        }
      )
    );
  });
});
