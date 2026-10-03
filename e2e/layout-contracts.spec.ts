import { test, expect, type Page } from "@playwright/test";

/**
 * Layout and typography contracts of public/styles/main.css, checked
 * through the real stylesheet applied to real pages in a real browser.
 *
 * These replace regexes over the CSS text (src/routes/real-data.test.ts),
 * which failed on behavior-preserving rewrites and passed when a later rule
 * overrode the one they matched. Each test states an observable relation —
 * where the rail sits, which elements share a type scale — rather than the
 * declarations that currently produce it.
 *
 * Runs on the desktop project only; each test sets its own viewport.
 * Requires the seeded fixture (npm run fixture:local).
 */

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

const DESKTOP = { width: 1280, height: 900 };
const TABLET = { width: 820, height: 1180 };
const PHONE = { width: 375, height: 812 };

async function open(page: Page, path: string, viewport = DESKTOP) {
  await page.setViewportSize(viewport);
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${path} must exist in the seeded fixture`).toBe(200);
  await expect(page.locator(".empty-archive-state"), `${path} rendered the empty-archive state`).toHaveCount(0);
}

async function box(page: Page, selector: string): Promise<Box> {
  const locator = page.locator(selector).first();
  await expect(locator, `${selector} must be visible`).toBeVisible();
  const b = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, width: r.width, height: r.height };
  });
  return b;
}

async function style(page: Page, selector: string, props: string[]): Promise<Record<string, string>> {
  const locator = page.locator(selector).first();
  await expect(locator, `${selector} must be present`).toBeAttached();
  return locator.evaluate((el, names) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(names.map((name) => [name, cs.getPropertyValue(name)]));
  }, props);
}

const TOPIC = "/topics/chatgpt";
const RAIL_PAGES = ["/", "/episodes", TOPIC, "/episodes/2026-05-12-rail-demo", "/chunks/rail-demo-current-1"];

test.describe("page grid", () => {
  test("the wide canvas is wider than the default main column, and neither is a grid", async ({ page }) => {
    // Every routed page opts into main-wide; the not-found page keeps the
    // default single column.
    await page.setViewportSize(DESKTOP);
    const notFound = await page.goto("/no-such-page-for-layout-contracts");
    expect(notFound?.status()).toBe(404);
    const narrowMain = await page.locator("main").evaluate((el) => ({ cls: el.className, width: el.getBoundingClientRect().width, display: getComputedStyle(el).display }));
    expect(narrowMain.cls).not.toContain("main-wide");
    expect(narrowMain.display).not.toBe("grid");

    await open(page, "/search?q=ChatGPT");
    const wideMain = await page.locator("main.main-wide").evaluate((el) => ({ width: el.getBoundingClientRect().width, display: getComputedStyle(el).display }));
    expect(wideMain.display).not.toBe("grid");
    expect(wideMain.width).toBeGreaterThan(narrowMain.width);
    expect(wideMain.width).toBeLessThan(DESKTOP.width);

    // The search page has no rail: its single body column is narrower than
    // the wide shell around it.
    await expect(page.locator(".page-with-rail")).toHaveCount(0);
    const shell = await box(page, ".page-shell");
    const single = await box(page, ".page-body-single");
    expect(single.width).toBeLessThan(shell.width);
  });

  for (const path of RAIL_PAGES) {
    test(`${path} puts the rail beside the body on desktop and below it on phones`, async ({ page }) => {
      await open(page, path, DESKTOP);
      const body = await box(page, ".page-with-rail > .page-body");
      const rail = await box(page, ".page-with-rail > .page-rail");
      expect(rail.left, "rail starts right of the body").toBeGreaterThanOrEqual(body.right);
      expect(body.width, "body column is wider than the rail").toBeGreaterThan(rail.width);

      await open(page, path, PHONE);
      const phoneBody = await box(page, ".page-with-rail > .page-body");
      if (path === "/episodes") {
        // The year table of contents is dropped on phones rather than
        // stacked under thirteen thousand pixels of episodes.
        await expect(page.locator(".page-with-rail > .page-rail .page-toc")).toBeHidden();
        return;
      }
      const phoneRail = await box(page, ".page-with-rail > .page-rail");
      expect(phoneRail.top, "rail stacks below the body").toBeGreaterThanOrEqual(phoneBody.bottom);
      expect(Math.abs(phoneRail.left - phoneBody.left)).toBeLessThanOrEqual(1);
    });
  }

  test("topic detail gives its rail more room than the default rail and keeps two columns on tablets", async ({ page }) => {
    await open(page, "/episodes", DESKTOP);
    const defaultRail = await box(page, ".page-with-rail > .page-rail");

    await open(page, TOPIC, DESKTOP);
    const topicRail = await box(page, ".topic-detail-layout > .page-rail");
    const topicBody = await box(page, ".topic-detail-layout > .page-body");
    expect(topicRail.width).toBeGreaterThan(defaultRail.width);
    expect(topicBody.width).toBeGreaterThan(topicRail.width);

    await open(page, TOPIC, TABLET);
    const tabletBody = await box(page, ".topic-detail-layout > .page-body");
    const tabletRail = await box(page, ".topic-detail-layout > .page-rail");
    expect(tabletRail.left).toBeGreaterThanOrEqual(tabletBody.right);
  });

  // Pages whose body opens with a preamble (hero/tagline/title block).
  for (const path of ["/", "/episodes", TOPIC, "/episodes/2026-05-12-rail-demo"]) {
    test(`${path} starts the rail one standard gap below the preamble slot`, async ({ page }) => {
      await open(page, path, DESKTOP);
      const layout = page.locator(".page-with-rail--aligned").first();
      await expect(layout).toBeVisible();
      const m = await layout.evaluate((el) => {
        const preamble = el.querySelector(":scope > .page-body > .page-preamble")!.getBoundingClientRect();
        const rail = el.querySelector(":scope > .page-rail")!.getBoundingClientRect();
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return { gap: rail.top - preamble.bottom, rem, layoutTop: el.getBoundingClientRect().top, railTop: rail.top };
      });
      // --space-md is 1rem: the rail lines up with body content that
      // follows the preamble, rather than with the top of the page.
      expect(Math.abs(m.gap - m.rem), JSON.stringify(m)).toBeLessThanOrEqual(2);
      expect(m.railTop).toBeGreaterThan(m.layoutTop + m.rem);
    });
  }
});

test.describe("header search", () => {
  test("is shown on wide screens alongside the search page's own form", async ({ page }) => {
    await open(page, "/search?q=ChatGPT", DESKTOP);
    await expect(page.locator("header .header-search input[name=q]")).toBeVisible();
    await expect(page.locator("main .search-form input[name=q]")).toBeVisible();
    await expect(page.locator("header .search-icon")).toBeHidden();
  });

  test("collapses to the search icon on phones", async ({ page }) => {
    await open(page, "/topics", PHONE);
    await expect(page.locator("header .header-search")).toBeHidden();
    await expect(page.locator("header .search-icon")).toBeVisible();
  });
});

test.describe("rail panels", () => {
  test("each panel carries the warm card chrome; the rail wrapper does not", async ({ page }) => {
    await open(page, TOPIC);
    const pageBg = await page.locator("body").evaluate((el) => getComputedStyle(document.documentElement).backgroundColor || getComputedStyle(el).backgroundColor);
    const panels = page.locator(".page-rail .rail-panel");
    expect(await panels.count()).toBeGreaterThan(0);
    const panel = await style(page, ".page-rail .rail-panel", ["background-color", "border-top-width", "border-top-style"]);
    expect(panel["background-color"]).not.toBe(pageBg);
    expect(panel["background-color"]).not.toBe("rgba(0, 0, 0, 0)");
    expect(panel["border-top-style"]).toBe("solid");
    expect(parseFloat(panel["border-top-width"])).toBeGreaterThan(0);

    const wrapper = await style(page, ".page-rail", ["background-color", "border-top-style"]);
    expect(wrapper["background-color"]).toBe("rgba(0, 0, 0, 0)");
    expect(wrapper["border-top-style"]).toBe("none");
  });

  test("rail text uses the UI face, not the body serif", async ({ page }) => {
    await open(page, TOPIC);
    const rail = await style(page, ".page-rail", ["font-family"]);
    const prose = await style(page, "body", ["font-family"]);
    expect(rail["font-family"]).not.toBe(prose["font-family"]);
    expect(rail["font-family"]).toMatch(/system-ui|sans-serif/);
  });
  test("rail links read as body text; rail counts and meta are quieter", async ({ page }) => {
    await open(page, "/");
    const link = await style(page, ".recent-episodes .recent-ep-link", ["color"]);
    const count = await style(page, ".recent-episodes .recent-ep-link span", ["color", "font-family", "font-size"]);
    const bodyText = await style(page, "body", ["color", "font-size"]);
    const rail = await style(page, ".page-rail", ["font-family"]);
    expect(link.color).toBe(bodyText.color);
    expect(count.color).not.toBe(bodyText.color);
    expect(count["font-family"]).toBe(rail["font-family"]);
    expect(parseFloat(count["font-size"])).toBeLessThan(parseFloat(bodyText["font-size"]));

    await page.locator(".recent-episodes .recent-ep-link").first().hover();
    const hovered = await style(page, ".recent-episodes .recent-ep-link:hover", ["color"]);
    expect(hovered.color).not.toBe(bodyText.color);
  });
});

test.describe("help tips", () => {
  test("opening a tip overlays its bubble without moving the surrounding layout", async ({ page }) => {
    await open(page, TOPIC);
    const tip = page.locator(".page-rail .topic-help-tip").first();
    await tip.scrollIntoViewIfNeeded();
    const panel = tip.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' rail-panel ')][1]");
    const before = await panel.evaluate((el) => el.getBoundingClientRect().height);

    await tip.locator("summary").click();
    const bubble = tip.locator(".topic-help-tip-bubble");
    await expect(bubble).toBeVisible();
    const after = await panel.evaluate((el) => el.getBoundingClientRect().height);
    expect(after).toBe(before);

    // The bubble paints above whatever it overlaps.
    const onTop = await bubble.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop).toBe(true);
  });
});

test.describe("type scale", () => {
  const TITLE_PROPS = ["font-family", "font-size", "font-weight"];

  test("episode rows, search-result titles and topic tiles share one title scale", async ({ page }) => {
    await open(page, "/episodes");
    const episodeTitle = await style(page, ".browse-episodes .list-row-title", TITLE_PROPS);
    await open(page, "/search?q=ChatGPT");
    const resultTitle = await style(page, ".chunk-card h3", TITLE_PROPS);
    await open(page, "/topics");
    const topicTile = await style(page, ".multiple-name", TITLE_PROPS);
    const paragraph = await style(page, "main p", ["font-family", "font-size"]);

    expect(resultTitle).toEqual(episodeTitle);
    expect(topicTile).toEqual(episodeTitle);
    // ...and that scale is the body text scale, not a heading scale.
    expect(episodeTitle["font-family"]).toBe(paragraph["font-family"]);
    expect(episodeTitle["font-size"]).toBe(paragraph["font-size"]);
  });

  test("section headings are uppercase UI labels", async ({ page }) => {
    await open(page, "/");
    const heading = await style(page, ".section-heading", ["text-transform", "font-family"]);
    const rail = await style(page, ".page-rail", ["font-family"]);
    expect(heading["text-transform"]).toBe("uppercase");
    expect(heading["font-family"]).toBe(rail["font-family"]);
  });

  test("the topic header's support text uses one muted colour, distinct from body text", async ({ page }) => {
    await open(page, TOPIC);
    const selectors = [".topic-header-stats", ".topic-distinctiveness", ".topic-related-label"];
    const colours = [];
    for (const selector of selectors) colours.push((await style(page, selector, ["color"])).color);
    const bodyText = (await style(page, "body", ["color"])).color;
    expect(new Set(colours).size, `${selectors.join(", ")} -> ${colours.join(", ")}`).toBe(1);
    expect(colours[0]).not.toBe(bodyText);
  });
});
