import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.tsx",
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    minWorkers: 1,
    maxWorkers: 4,
    exclude: ["e2e/**", "node_modules/**", "src/**/distinctiveness.test.ts", "src/routes/real-data.test.ts", "src/services/real-data.test.ts", "src/services/source-fidelity.corpus.test.tsx", ".claude/**"],
  },
});
