import { test, expect } from "@playwright/test";

const pages = [
  "/",
  "/topics",
  "/topics/swarm-sifting#in-context",
  "/search?q=swarm",
  "/episodes",
  "/episodes/2026-04-14-preview",
  "/chunks/swarm-sifting-sort-2026-04-14-preview-0",
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
    for (const path of pages) {
      test(`${path} has no overflow or clipped visible text`, async ({ page }) => {
        test.skip(test.info().project.name !== "desktop", "desktop project runs all viewport audits explicitly");
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(path, { waitUntil: "domcontentloaded" });

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
