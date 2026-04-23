import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../public/styles/main.css", import.meta.url), "utf8");

describe("Layout CSS invariants", () => {
  it("keeps main as a single-column container rather than a global body-rail grid", () => {
    expect(styles).toMatch(/main\s*\{[^}]*max-width:\s*var\(--max-width\);/s);
    expect(styles).not.toMatch(/main\s*\{[^}]*grid-template-columns:/s);
  });

  it("provides an opt-in page-with-rail grid for pages that need side content", () => {
    expect(styles).toMatch(/\.page-with-rail\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*var\(--page-grid-columns,\s*minmax\(0,\s*1fr\)\s*var\(--sidebar-width\)\);/s);
    expect(styles).toMatch(/\.page-with-rail\s*\{[^}]*max-width:\s*var\(--page-grid-max,\s*var\(--max-width-wide\)\);/s);
    expect(styles).toMatch(/\.page-rail\s*\{[^}]*font-family:\s*var\(--font-ui\);/s);
  });

  it("does not leave old page-specific wrappers defining the canonical grid", () => {
    expect(styles).not.toMatch(/\.home-with-margin\s*\{[^}]*display:\s*grid;/s);
    expect(styles).not.toMatch(/\.topic-detail-layout\s*\{[^}]*display:\s*grid;/s);
  });

  it("lets topic detail tune the shared grid with page-level tokens", () => {
    expect(styles).toMatch(/\.topic-detail-layout\s*\{[^}]*--page-grid-columns:\s*minmax\(0,\s*1\.75fr\)\s*minmax\(14rem,\s*17rem\);/s);
    expect(styles).toMatch(/\.topic-detail-layout\s*\{[^}]*--page-grid-gap:\s*1\.5rem;/s);
    expect(styles).toMatch(/@media \(max-width:\s*1024px\)\s*\{[^}]*\.topic-detail-layout\s*\{[^}]*--page-grid-columns:\s*minmax\(0,\s*1\.55fr\)\s*minmax\(13rem,\s*15rem\);/s);
  });

  it("provides a shared preamble slot for aligned rail pages", () => {
    expect(styles).toMatch(/\.page-with-rail--aligned\s*\{[^}]*--rail-start-offset:\s*2\.75rem;/s);
    expect(styles).toMatch(/\.page-with-rail--aligned > \.page-body > \.page-preamble\s*\{[^}]*min-height:\s*var\(--rail-start-offset\);/s);
    expect(styles).toMatch(/\.page-with-rail--aligned > \.page-rail\s*\{[^}]*margin-top:\s*calc\(var\(--rail-start-offset\) \+ var\(--space-md\)\);/s);
  });

  it("defines a shared wide container and a single-column page shell", () => {
    expect(styles).toMatch(/:root\s*\{[^}]*--max-width-wide:\s*62rem;/s);
    expect(styles).toMatch(/\.main-wide\s*\{[^}]*max-width:\s*var\(--max-width-wide\);/s);
    expect(styles).toMatch(/\.page-shell\s*\{[^}]*max-width:\s*var\(--page-shell-max,\s*var\(--max-width-wide\)\);/s);
    expect(styles).toMatch(/\.page-body-single\s*\{[^}]*max-width:\s*var\(--page-content-max,\s*var\(--max-width\)\);/s);
  });

  it("provides a reusable topic help-tip pattern", () => {
    expect(styles).toMatch(/\.topic-help-tip\s*\{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.topic-help-tip-bubble\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*20;/s);
  });

  it("shows desktop header search while retaining the page-level search form styles", () => {
    expect(styles).toMatch(/\.header-search\s*\{[^}]*display:\s*flex;/s);
    expect(styles).toMatch(/\.search-form\s*\{[^}]*display:\s*flex;/s);
  });

  it("gives individual rail panels the warm-panel chrome instead of the rail wrapper", () => {
    expect(styles).toMatch(/\.rail-panel\s*\{[^}]*background:\s*var\(--bg-warm\);[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*6px;[^}]*padding:\s*0\.9rem 1rem;/s);
    expect(styles).not.toMatch(/\.topics-margin\s*\{[^}]*background:\s*var\(--bg-warm\);/s);
  });

  it("defines a shared color system for rail panels", () => {
    expect(styles).toMatch(/\.rail-stack\s*\{[^}]*--rail-title-color:\s*var\(--text-light\);/s);
    expect(styles).toMatch(/\.rail-stack\s*\{[^}]*--rail-link-color:\s*var\(--text\);/s);
    expect(styles).toMatch(/\.rail-stack\s*\{[^}]*--rail-link-hover:\s*var\(--accent-dark\);/s);
    expect(styles).toMatch(/\.rail-stack\s*\{[^}]*--rail-meta-color:\s*var\(--text-light\);/s);
    expect(styles).toMatch(/\.rail-stack\s*\{[^}]*--rail-signal-color:\s*var\(--accent-dark\);/s);
  });

  it("removes dead legacy visualization and rail selectors", () => {
    expect(styles).not.toContain(".related-chunks {");
    expect(styles).not.toContain(".diff-view {");
    expect(styles).not.toContain(".reactive-timeline {");
    expect(styles).not.toContain(".theme-river {");
    expect(styles).not.toContain(".topic-slopegraph {");
  });
});
