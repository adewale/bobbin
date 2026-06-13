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
    // scripts/** and the entries below run under vitest.node.config.ts;
    // listing them here keeps every test file in exactly one suite.
    exclude: ["e2e/**", "node_modules/**", "scripts/**", "src/**/distinctiveness.test.ts", "src/**/html-parser.property.test.ts", "src/routes/real-data.test.ts", "src/services/real-data.test.ts", "src/services/source-fidelity.corpus.test.tsx", ".claude/**"],
  },
});
