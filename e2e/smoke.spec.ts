import { test, expect } from "@playwright/test";

/**
 * Smoke tests for every major page.
 * Each page is checked for: HTTP 200, expected content, and no console errors.
 * Mobile tests additionally check that the header nav fits in one line.
 */

// Pages to smoke-test: [path, expected title substring, expected heading text]
const htmlPages: Array<{
  path: string;
  titleContains: string;
  headingText: string;
}> = [
  { path: "/", titleContains: "Home", headingText: "Bobbin" },
  { path: "/episodes", titleContains: "Browse", headingText: "Browse" },
  { path: "/topics", titleContains: "Topics", headingText: "Topics" },
  {
    path: "/word-stats",
    titleContains: "Word Stats",
    headingText: "Word Stats",
  },
  { path: "/search", titleContains: "Search", headingText: "Search" },
  {
    path: "/search?q=ecosystem",
    titleContains: "ecosystem",
    headingText: "Search",
  },
];

const xmlPages: Array<{
  path: string;
  rootElement: string;
  contentType: string;
}> = [
  {
    path: "/feed.xml",
    rootElement: "feed",
    contentType: "application/atom+xml",
  },
  {
    path: "/sitemap.xml",
    rootElement: "urlset",
    contentType: "application/xml",
  },
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

      // (b) Expected heading
      const h1 = p.locator("h1").first();
      await expect(h1).toContainText(page.headingText);

      // (c) No console errors
      expect(consoleErrors).toEqual([]);
    });
  });
}

// ── Mobile-specific: header fits in one line ────────────────────────────

for (const page of htmlPages) {
  test.describe(`Mobile nav: ${page.path}`, () => {
    test.skip(
      ({ browserName }, testInfo) =>
        testInfo.project.name !== "mobile",
      "mobile-only test"
    );

    test("header nav height is < 60px", async ({ page: p }) => {
      await p.goto(page.path, { waitUntil: "domcontentloaded" });

      const nav = p.locator("header nav");
      const box = await nav.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.height).toBeLessThan(60);
    });
  });
}

// ── XML feeds ───────────────────────────────────────────────────────────

for (const feed of xmlPages) {
  test.describe(`Smoke: ${feed.path}`, () => {
    test("returns 200 with correct content-type and valid XML root", async ({
      request,
    }) => {
      const response = await request.get(feed.path);

      // (a) HTTP 200
      expect(response.status()).toBe(200);

      // (b) Content-Type
      const ct = response.headers()["content-type"] || "";
      expect(ct).toContain(feed.contentType);

      // (b) Body contains the expected XML root element
      const body = await response.text();
      expect(body).toContain(`<${feed.rootElement}`);
    });
  });
}

// ── Search with results ─────────────────────────────────────────────────

test.describe("Smoke: /search?q=ecosystem (results)", () => {
  test("returns search results", async ({ page: p }) => {
    await p.goto("/search?q=ecosystem", { waitUntil: "domcontentloaded" });

    const resultsSection = p.locator(".search-results");
    await expect(resultsSection).toBeVisible();

    // At least the results summary line should mention "ecosystem"
    const summary = resultsSection.locator("p").first();
    await expect(summary).toContainText("ecosystem");
  });
});
