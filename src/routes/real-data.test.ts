import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../public/styles/main.css", import.meta.url), "utf8");

describe("Layout CSS invariants", () => {
  it("keeps main as a single-column container rather than a global body-rail grid", () => {
    expect(styles).toMatch(/main\s*\{[^}]*max-width:\s*var\(--max-width\);/s);
    expect(styles).not.toMatch(/main\s*\{[^}]*grid-template-columns:/s);
  });

  it("provides an opt-in page-with-rail grid for pages that need side content", () => {
    expect(styles).toMatch(/\.page-with-rail\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--sidebar-width\);/s);
    expect(styles).toMatch(/\.page-rail\s*\{[^}]*font-family:\s*var\(--font-ui\);/s);
  });

  it("does not leave old page-specific wrappers defining the canonical grid", () => {
    expect(styles).not.toMatch(/\.home-with-margin\s*\{[^}]*display:\s*grid;/s);
    expect(styles).not.toMatch(/\.topic-detail-layout\s*\{[^}]*display:\s*grid;/s);
  });

  it("does not use overflow-hiding masks for visible kwic text", () => {
    expect(styles).toMatch(/\.kwic-line \.kwic-left,\s*\.kwic-line \.kwic-right \{[^}]*white-space:\s*normal;[^}]*overflow:\s*visible;/s);
    expect(styles).not.toMatch(/\.kwic-line \.kwic-left \{[^}]*mask-image:/s);
    expect(styles).not.toMatch(/\.kwic-line \.kwic-right \{[^}]*mask-image:/s);
    expect(styles).not.toContain(".kwic-table {");
    expect(styles).not.toMatch(/\n\.kwic-left \{/);
    expect(styles).not.toMatch(/\n\.kwic-right \{/);
  });

  it("shows desktop header search while retaining the page-level search form styles", () => {
    expect(styles).toMatch(/\.header-search\s*\{[^}]*display:\s*flex;/s);
    expect(styles).toMatch(/\.search-form\s*\{[^}]*display:\s*flex;/s);
  });

  it("gives topics-margin the same warm-panel chrome as other secondary UI", () => {
    expect(styles).toMatch(/\.topics-margin\s*\{[^}]*background:\s*var\(--bg-warm\);[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*6px;/s);
  });

  it("removes dead legacy visualization and rail selectors", () => {
    expect(styles).not.toContain(".related-chunks {");
    expect(styles).not.toContain(".diff-view {");
    expect(styles).not.toContain(".reactive-timeline {");
    expect(styles).not.toContain(".theme-river {");
    expect(styles).not.toContain(".topic-slopegraph {");
  });
});
