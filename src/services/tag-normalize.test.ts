import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeTerm } from "./tag-generator";

describe("normalizeTerm (plural → singular)", () => {
  it("strips trailing 's' from regular plurals", () => {
    expect(normalizeTerm("systems")).toBe("system");
    expect(normalizeTerm("models")).toBe("model");
    expect(normalizeTerm("agents")).toBe("agent");
    expect(normalizeTerm("tools")).toBe("tool");
    expect(normalizeTerm("values")).toBe("value");
    expect(normalizeTerm("products")).toBe("product");
    expect(normalizeTerm("loops")).toBe("loop");
    expect(normalizeTerm("teams")).toBe("team");
    expect(normalizeTerm("contexts")).toBe("context");
  });

  it("strips 'es' from -es plurals", () => {
    expect(normalizeTerm("processes")).toBe("process");
    expect(normalizeTerm("chatbots")).toBe("chatbot");
  });

  it("does NOT strip 's' from words that end in 's' naturally", () => {
    expect(normalizeTerm("llms")).toBe("llms");
    expect(normalizeTerm("chatgpt")).toBe("chatgpt");
    expect(normalizeTerm("process")).toBe("process");
    expect(normalizeTerm("trust")).toBe("trust");
  });

  it("does NOT strip 's' from short words", () => {
    expect(normalizeTerm("this")).toBe("this");
    expect(normalizeTerm("bus")).toBe("bus");
  });

  it("normalizes multi-word entities", () => {
    expect(normalizeTerm("Grubby Truffles")).toBe("grubby truffle");
    expect(normalizeTerm("Gilded Turds")).toBe("gilded turd");
    expect(normalizeTerm("Claude Codes")).toBe("claude code");
  });

  it("lowercases for consistency", () => {
    expect(normalizeTerm("LLMs")).toBe("llms");
    expect(normalizeTerm("Software")).toBe("software");
    expect(normalizeTerm("Claude Code")).toBe("claude code");
  });
});

describe("PBT: normalizeTerm invariants", () => {
  it("output is always lowercase", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4, maxLength: 30 }), (input) => {
        const result = normalizeTerm(input);
        expect(result).toBe(result.toLowerCase());
      })
    );
  });

  it("normalizing twice gives the same result as once (idempotent)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4, maxLength: 30 }), (input) => {
        const once = normalizeTerm(input);
        const twice = normalizeTerm(once);
        expect(twice).toBe(once);
      })
    );
  });

  it("output is never longer than input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4, maxLength: 30 }), (input) => {
        expect(normalizeTerm(input).length).toBeLessThanOrEqual(input.length);
      })
    );
  });
});
