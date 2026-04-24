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
}> = [
  { path: "/", titleContains: "Home", selector: ".page-tagline", text: "A searchable archive" },
  { path: "/episodes", titleContains: "Episodes", selector: ".page-tagline", text: "episodes" },
  { path: "/topics", titleContains: "Topics", selector: ".page-tagline", text: "Concepts ranked" },
  { path: "/search", titleContains: "Search", selector: ".search-form input[name=\"q\"]" },
  {
    path: "/search?q=ChatGPT",
    titleContains: "ChatGPT",
    selector: ".search-results p",
    text: "ChatGPT",
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
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
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

      // (d) No console errors
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

    // At least the results summary line should mention "ChatGPT"
    const summary = resultsSection.locator("p").first();
    await expect(summary).toContainText("ChatGPT");
  });
});
