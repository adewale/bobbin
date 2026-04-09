import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("converts title to kebab-case slug", () => {
    expect(slugify("Nanotech Cages for Circus Bears")).toBe(
      "nanotech-cages-for-circus-bears"
    );
  });

  it("strips special characters", () => {
    expect(slugify("LLM-fu & AI's Promise")).toBe("llm-fu-ais-promise");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("  Hello World!  ")).toBe("hello-world");
  });

  it("collapses multiple dashes", () => {
    expect(slugify("one---two---three")).toBe("one-two-three");
  });
});
