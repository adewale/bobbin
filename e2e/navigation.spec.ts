import { test, expect } from "@playwright/test";

/**
 * Navigation tests: click through the site and verify links lead to real pages.
 */

test.describe("Navigation", () => {
  test("click an episode from the browse page -> arrives at episode detail", async ({
    page,
  }) => {
    await page.goto("/episodes", { waitUntil: "domcontentloaded" });

    // Find the first episode link inside the browse listing
    const episodeLink = page.locator(".browse-episodes a").first();
    await expect(episodeLink).toBeVisible();

    const href = await episodeLink.getAttribute("href");
    expect(href).toMatch(/^\/episodes\//);

    await Promise.all([
      page.waitForURL(/\/episodes\/[^/]+$/),
      episodeLink.click(),
    ]);
    await page.waitForLoadState("networkidle");

    // Should not be a 404
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible();
    await expect(h1).not.toContainText("404");

    // URL should be an episode detail page
    expect(page.url()).toMatch(/\/episodes\/[^/]+/);
  });

  test("click a chunk from an episode -> arrives at chunk detail", async ({
    page,
  }) => {
    await page.goto("/episodes", { waitUntil: "domcontentloaded" });

    // Navigate to the first episode
    const episodeLink = page.locator(".browse-episodes a").first();
    await Promise.all([
      page.waitForURL(/\/episodes\/[^/]+$/),
      episodeLink.click(),
    ]);
    await page.waitForLoadState("networkidle");

    // Find a chunk link (in the TOC list or essay section)
    const chunkLink = page
      .locator('a[href^="/chunks/"]')
      .first();
    await expect(chunkLink).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/chunks\/[^/]+$/),
      chunkLink.click(),
    ]);
    await page.waitForLoadState("networkidle");

    // Should not be a 404
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible();
    await expect(h1).not.toContainText("404");

    // URL should be a chunk detail page
    expect(page.url()).toMatch(/\/chunks\/[^/]+/);
  });

  test("click a topic from the topics page -> arrives at topic detail", async ({
    page,
  }) => {
    await page.goto("/topics", { waitUntil: "domcontentloaded" });

    // Find any topic link in the topic cloud
    const topicLink = page.locator('a[href^="/topics/"]').first();
    await expect(topicLink).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/topics\/[^/]+$/),
      topicLink.click(),
    ]);
    await page.waitForLoadState("networkidle");

    // Should not be a 404
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible();
    await expect(h1).not.toContainText("404");

    // URL should be a topic detail page
    expect(page.url()).toMatch(/\/topics\/[^/]+/);

    // Page heading should include "Topic:"
    await expect(h1).toContainText("Topic:");
  });

  test('search for "ChatGPT" -> results appear', async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });

    // Fill in the search form
    const searchForm = page.locator(".search-form");
    const searchInput = searchForm.locator('input[name="q"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("ChatGPT");

    // Submit the form
    const submitButton = searchForm.locator('button[type="submit"]');
    await submitButton.click();
    await page.waitForLoadState("domcontentloaded");

    // URL should include the query param
    expect(page.url()).toContain("q=ChatGPT");

    // Results section should appear
    const resultsSection = page.locator(".search-results");
    await expect(resultsSection).toBeVisible();

    // Should show at least one result
    const summary = resultsSection.locator("p").first();
    await expect(summary).toContainText(/^[1-9][0-9]* results? for/u);
    await expect(summary).toContainText("ChatGPT");
  });
});
