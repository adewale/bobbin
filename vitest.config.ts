import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.tsx",
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    exclude: ["e2e/**", "node_modules/**", "src/**/distinctiveness.test.ts", ".claude/**"],
  },
});
