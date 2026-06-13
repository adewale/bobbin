import { defineConfig, devices } from "@playwright/test";

const ignoreVisualTests = !process.env.AI_GATEWAY_API_KEY && !process.env.RUN_VISUAL_TESTS
  ? ["e2e/visual.spec.ts"]
  : [];

// Default to a locally served app (seed it first: npm run fixture:local)
// so e2e runs exercise the code under review. Set BASE_URL to point the
// suite at a deployed environment instead (production smoke checks).
const baseURL = process.env.BASE_URL || "http://localhost:9090";

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
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  webServer: process.env.BASE_URL
    ? undefined
    : {
        // wrangler.e2e.jsonc serves the fixture-seeded local D1 without the
        // remote-only AI/Vectorize bindings, so no Cloudflare login is needed.
        command: "npx wrangler dev --config wrangler.e2e.jsonc --port 9090",
        url: "http://localhost:9090",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
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
