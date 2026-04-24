import { defineConfig, devices } from "@playwright/test";

const ignoreVisualTests = !process.env.AI_GATEWAY_API_KEY && !process.env.RUN_VISUAL_TESTS
  ? ["e2e/visual.spec.ts"]
  : [];

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }]],

  use: {
    baseURL:
      process.env.BASE_URL || "https://bobbin.adewale-883.workers.dev",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "desktop",
      testIgnore: ignoreVisualTests,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "mobile",
      testIgnore: [...ignoreVisualTests, "e2e/layout-grid.spec.ts"],
      use: {
        ...devices["iPhone 15"],
        viewport: { width: 393, height: 852 },
      },
    },
  ],
});
