import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.tsx",
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        // Workers AI and Vectorize need a Cloudflare login, so the test
        // runtime binds in-memory fakes that follow their interfaces
        // (test/fakes/). Every `env.AI && env.VECTORIZE` path now runs
        // under test; tests that need the unbound path pass AI: null.
        wrappedBindings: {
          AI: { scriptName: "bobbin-fake-workers-ai" },
          VECTORIZE: { scriptName: "bobbin-fake-vectorize", bindings: { DIMENSIONS: 768 } },
        },
        workers: [
          { name: "bobbin-fake-workers-ai", modules: true, scriptPath: "./test/fakes/workers-ai.mjs" },
          { name: "bobbin-fake-vectorize", modules: true, scriptPath: "./test/fakes/vectorize.mjs" },
        ],
      },
    }),
  ],
  test: {
    minWorkers: 1,
    maxWorkers: 4,
    setupFiles: ["./test/setup/reset-fakes.ts"],
    // scripts/**, test/** and the entries below run under
    // vitest.node.config.ts; listing them here keeps every test file in
    // exactly one suite.
    exclude: ["e2e/**", "node_modules/**", "scripts/**", "test/**", "src/**/distinctiveness.test.ts", "src/**/html-parser.property.test.ts", "src/routes/real-data.test.ts", "src/services/real-data.test.ts", "src/services/source-fidelity.corpus.test.tsx", ".claude/**"],
  },
});
