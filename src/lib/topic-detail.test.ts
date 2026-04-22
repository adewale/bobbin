import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildTerminologyDrift } from "./topic-detail";

describe("buildTerminologyDrift", () => {
  it("separates earlier and later vocabulary while excluding the topic token itself", () => {
    const drift = buildTerminologyDrift(
      [
        { content_plain: "LLMs use orchestration and agents for complex tasks." },
        { content_plain: "LLMs and agent loops benefit from eval harnesses." },
        { content_plain: "Claude code and security workflows now shape llms in practice." },
        { content_plain: "Security reviews and claude usage became the later pattern for llms." },
      ],
      "llms"
    );

    expect(drift.earlier.length).toBeGreaterThan(0);
    expect(drift.later.length).toBeGreaterThan(0);
    expect(drift.earlier.map((term) => term.word)).toContain("agents");
    expect(drift.later.map((term) => term.word)).toContain("security");
    expect(drift.earlier.map((term) => term.word)).not.toContain("llms");
    expect(drift.later.map((term) => term.word)).not.toContain("llms");
    expect(drift.earlier.every((term) => term.delta < 0)).toBe(true);
    expect(drift.later.every((term) => term.delta > 0)).toBe(true);
    expect(drift.earlier.some((term) => drift.later.some((later) => later.word === term.word))).toBe(false);
  });

  it("never emits the topic token for arbitrary chunk text", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 2, maxLength: 8 }),
        (texts) => {
          const drift = buildTerminologyDrift(
            texts.map((content_plain) => ({ content_plain })),
            "claude"
          );

          for (const term of [...drift.earlier, ...drift.later]) {
            expect(term.word).not.toBe("claude");
            expect(term.word.length).toBeGreaterThan(0);
          }
        }
      )
    );
  });
});
