# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Mobile nav: /tags >> header nav height is < 60px
- Location: e2e/smoke.spec.ts:92:5

# Error details

```
TypeError: Cannot read properties of undefined (reading 'project')
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * Smoke tests for every major page.
  5   |  * Each page is checked for: HTTP 200, expected content, and no console errors.
  6   |  * Mobile tests additionally check that the header nav fits in one line.
  7   |  */
  8   | 
  9   | // Pages to smoke-test: [path, expected title substring, expected heading text]
  10  | const htmlPages: Array<{
  11  |   path: string;
  12  |   titleContains: string;
  13  |   headingText: string;
  14  | }> = [
  15  |   { path: "/", titleContains: "Home", headingText: "Bobbin" },
  16  |   { path: "/episodes", titleContains: "Browse", headingText: "Browse" },
  17  |   { path: "/tags", titleContains: "Tags", headingText: "Tags" },
  18  |   {
  19  |     path: "/concordance",
  20  |     titleContains: "Concordance",
  21  |     headingText: "Concordance",
  22  |   },
  23  |   { path: "/search", titleContains: "Search", headingText: "Search" },
  24  |   {
  25  |     path: "/search?q=ecosystem",
  26  |     titleContains: "ecosystem",
  27  |     headingText: "Search",
  28  |   },
  29  | ];
  30  | 
  31  | const xmlPages: Array<{
  32  |   path: string;
  33  |   rootElement: string;
  34  |   contentType: string;
  35  | }> = [
  36  |   {
  37  |     path: "/feed.xml",
  38  |     rootElement: "feed",
  39  |     contentType: "application/atom+xml",
  40  |   },
  41  |   {
  42  |     path: "/sitemap.xml",
  43  |     rootElement: "urlset",
  44  |     contentType: "application/xml",
  45  |   },
  46  | ];
  47  | 
  48  | // ── HTML pages ──────────────────────────────────────────────────────────
  49  | 
  50  | for (const page of htmlPages) {
  51  |   test.describe(`Smoke: ${page.path}`, () => {
  52  |     test("returns 200 with expected content and no console errors", async ({
  53  |       page: p,
  54  |     }) => {
  55  |       const consoleErrors: string[] = [];
  56  |       p.on("console", (msg) => {
  57  |         if (msg.type() === "error") {
  58  |           consoleErrors.push(msg.text());
  59  |         }
  60  |       });
  61  | 
  62  |       const response = await p.goto(page.path, {
  63  |         waitUntil: "domcontentloaded",
  64  |       });
  65  | 
  66  |       // (a) HTTP 200
  67  |       expect(response?.status()).toBe(200);
  68  | 
  69  |       // (b) Expected title
  70  |       await expect(p).toHaveTitle(new RegExp(page.titleContains, "i"));
  71  | 
  72  |       // (b) Expected heading
  73  |       const h1 = p.locator("h1").first();
  74  |       await expect(h1).toContainText(page.headingText);
  75  | 
  76  |       // (c) No console errors
  77  |       expect(consoleErrors).toEqual([]);
  78  |     });
  79  |   });
  80  | }
  81  | 
  82  | // ── Mobile-specific: header fits in one line ────────────────────────────
  83  | 
  84  | for (const page of htmlPages) {
  85  |   test.describe(`Mobile nav: ${page.path}`, () => {
  86  |     test.skip(
  87  |       ({ browserName }, testInfo) =>
> 88  |         testInfo.project.name !== "mobile",
      |                  ^ TypeError: Cannot read properties of undefined (reading 'project')
  89  |       "mobile-only test"
  90  |     );
  91  | 
  92  |     test("header nav height is < 60px", async ({ page: p }) => {
  93  |       await p.goto(page.path, { waitUntil: "domcontentloaded" });
  94  | 
  95  |       const nav = p.locator("header nav");
  96  |       const box = await nav.boundingBox();
  97  |       expect(box).toBeTruthy();
  98  |       expect(box!.height).toBeLessThan(60);
  99  |     });
  100 |   });
  101 | }
  102 | 
  103 | // ── XML feeds ───────────────────────────────────────────────────────────
  104 | 
  105 | for (const feed of xmlPages) {
  106 |   test.describe(`Smoke: ${feed.path}`, () => {
  107 |     test("returns 200 with correct content-type and valid XML root", async ({
  108 |       request,
  109 |     }) => {
  110 |       const response = await request.get(feed.path);
  111 | 
  112 |       // (a) HTTP 200
  113 |       expect(response.status()).toBe(200);
  114 | 
  115 |       // (b) Content-Type
  116 |       const ct = response.headers()["content-type"] || "";
  117 |       expect(ct).toContain(feed.contentType);
  118 | 
  119 |       // (b) Body contains the expected XML root element
  120 |       const body = await response.text();
  121 |       expect(body).toContain(`<${feed.rootElement}`);
  122 |     });
  123 |   });
  124 | }
  125 | 
  126 | // ── Search with results ─────────────────────────────────────────────────
  127 | 
  128 | test.describe("Smoke: /search?q=ecosystem (results)", () => {
  129 |   test("returns search results", async ({ page: p }) => {
  130 |     await p.goto("/search?q=ecosystem", { waitUntil: "domcontentloaded" });
  131 | 
  132 |     const resultsSection = p.locator(".search-results");
  133 |     await expect(resultsSection).toBeVisible();
  134 | 
  135 |     // At least the results summary line should mention "ecosystem"
  136 |     const summary = resultsSection.locator("p").first();
  137 |     await expect(summary).toContainText("ecosystem");
  138 |   });
  139 | });
  140 | 
```