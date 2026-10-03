import { test, expect } from "@playwright/test";

// Each page names a landmark that only renders when the seeded fixture
// (npm run fixture:local) is loaded. A 200 alone is not enough: the home,
// topics, episodes and search pages answer 200 on an empty database too,
// with an empty-archive notice that would otherwise be audited instead.
// (/design is static and shows that notice on purpose, as a sample.)
const pages = [
  { path: "/", archive: true, landmark: ".latest-episode-panel" },
  { path: "/topics", archive: true, landmark: ".multiples-grid" },
  { path: "/topics/chatgpt#observations", archive: true, landmark: ".topic-detail-layout" },
  { path: "/search?q=ChatGPT", archive: true, landmark: ".chunk-card" },
  { path: "/episodes", archive: true, landmark: ".browse-episodes" },
  { path: "/episodes/2026-05-12-rail-demo", archive: true, landmark: ".episode-chunks" },
  { path: "/chunks/rail-demo-current-1", archive: true, landmark: ".chunk-detail" },
  { path: "/design", landmark: "main h1" },
];

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 375, height: 812 },
];

async function auditLayout(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const hiddenTextCandidates = [...document.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        const text = el.textContent?.trim();
        if (!text) return false;
        const cs = getComputedStyle(el);
        return (cs.overflow === "hidden" || cs.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth;
      })
      .slice(0, 10)
      .map((el) => ({ tag: el.tagName, className: el.className, text: el.textContent?.trim().slice(0, 80) || "" }));

    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      hiddenTextCandidates,
      navHeight: document.querySelector("header nav")?.getBoundingClientRect().height ?? null,
      sparkTextOutsideSvg: [...document.querySelectorAll<SVGTextElement>('.topic-spark-svg text')]
        .filter((el) => {
          const textBox = el.getBoundingClientRect();
          const svgBox = el.ownerSVGElement?.getBoundingClientRect();
          if (!svgBox) return false;
          return textBox.top < svgBox.top - 0.5 || textBox.right > svgBox.right + 0.5 || textBox.bottom > svgBox.bottom + 0.5 || textBox.left < svgBox.left - 0.5;
        })
        .map((el) => el.textContent?.trim() || ""),
    };
  });
}

for (const viewport of viewports) {
  test.describe(`layout-grid ${viewport.name}`, () => {
    for (const { path, landmark, archive } of pages) {
      test(`${path} has no overflow or clipped visible text`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await page.goto(path, { waitUntil: "networkidle" });

        // Guard against silently auditing the 404 page or the empty-archive
        // state when the fixture hasn't been seeded.
        expect(response?.status(), `${path} must exist in the seeded fixture`).toBe(200);
        if (archive) {
          await expect(page.locator(".empty-archive-state"), `${path} rendered the empty-archive state`).toHaveCount(0);
        }
        await expect(page.locator(landmark).first(), `${path} must render ${landmark}`).toBeVisible();

        const audit = await auditLayout(page);

        expect(audit.overflow).toBe(false);
        expect(audit.hiddenTextCandidates).toEqual([]);
        expect(audit.sparkTextOutsideSvg).toEqual([]);

        if (viewport.name === "mobile") {
          expect(audit.navHeight).not.toBeNull();
          expect(audit.navHeight!).toBeLessThan(72);
        }
      });
    }
  });
}
