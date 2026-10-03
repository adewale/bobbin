import { test, expect } from "@playwright/test";

/**
 * Smoke tests for every major page.
 * Each page is checked for: HTTP 200, expected content, and no console errors.
 * Mobile tests additionally check that the header nav fits in one line.
 */

// Pages to smoke-test: [path, expected title substring, stable selector/text]
const htmlPages: Array<{
  path: string;
  titleContains: string;
  selector: string;
  text?: string;
  /** Renders archive data, so it must not show the empty-archive notice. */
  archive?: boolean;
}> = [
  { path: "/", titleContains: "Home", selector: ".page-tagline", text: "A searchable archive", archive: true },
  { path: "/episodes", titleContains: "Episodes", selector: ".page-tagline", text: "episodes", archive: true },
  { path: "/topics", titleContains: "Topics", selector: ".page-tagline", text: "Concepts ranked", archive: true },
  { path: "/search", titleContains: "Search", selector: ".search-form input[name=\"q\"]" },
  {
    path: "/search?q=ChatGPT",
    titleContains: "ChatGPT",
    selector: ".search-results p",
    text: "ChatGPT",
    archive: true,
  },
  { path: "/design", titleContains: "Design", selector: "h1", text: "Design" },
];

// ── HTML pages ──────────────────────────────────────────────────────────

for (const page of htmlPages) {
  test.describe(`Smoke: ${page.path}`, () => {
    test("returns 200 with expected content and no console errors", async ({
      page: p,
    }) => {
      const consoleErrors: string[] = [];
      p.on("console", (msg) => {
        if (msg.type() !== "error") return;
        // Only same-origin resources and page scripts are part of the app's
        // contract; third-party CDN availability (e.g. the fonts stylesheet)
        // varies with the environment's egress policy.
        const sourceUrl = msg.location()?.url ?? "";
        try {
          if (sourceUrl && new URL(sourceUrl).host !== new URL(p.url()).host) return;
        } catch {
          // Unparseable source URL — keep the error visible.
        }
        consoleErrors.push(msg.text());
      });

      const response = await p.goto(page.path, {
        waitUntil: "domcontentloaded",
      });

      // (a) HTTP 200
      expect(response?.status()).toBe(200);

      // (b) Expected title
      await expect(p).toHaveTitle(new RegExp(page.titleContains, "i"));

      // (c) Expected stable content
      const target = p.locator(page.selector).first();
      await expect(target).toBeVisible();
      if (page.text) {
        await expect(target).toContainText(page.text);
      }

      // (d) Archive pages rendered data, not the empty-archive notice that
      // the same 200 response carries on an unseeded database. (/design
      // shows that notice on purpose, as a component sample.)
      if (page.archive) {
        await expect(p.locator(".empty-archive-state")).toHaveCount(0);
      }

      // (e) No console errors
      expect(consoleErrors).toEqual([]);
    });
  });
}

// ── Search with results ─────────────────────────────────────────────────

test.describe("Smoke: /search?q=ChatGPT (results)", () => {
  test("returns search results", async ({ page: p }) => {
    await p.goto("/search?q=ChatGPT", { waitUntil: "domcontentloaded" });

    const resultsSection = p.locator(".search-results");
    await expect(resultsSection).toBeVisible();

    // The summary names the query and counts at least one result ("0
    // results for “ChatGPT”" also contains "ChatGPT"), and a result renders.
    const summary = resultsSection.locator("p").first();
    await expect(summary).toContainText(/^[1-9][0-9]* results? for/u);
    await expect(summary).toContainText("ChatGPT");
    await expect(resultsSection.locator(".chunk-card").first()).toBeVisible();
  });
});
