import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Scale tests seed hundreds of chunks and thousands of chunk_topics rows and
// run whole-pipeline finalization. They run in their own project, one file
// at a time (`npm run test:slow`), with a budget sized from measurement,
// instead of competing with the rest of the suite under a 5 s default.
const SLOW_TESTS = ["src/jobs/finalization-scale.test.ts"];

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
    projects: [
      {
        extends: true,
        test: {
          name: "workers",
          // scripts/**, test/** and the entries below run under
          // vitest.node.config.ts; listing them here keeps every test file in
          // exactly one suite. Scale tests run in workers-slow.
          exclude: ["e2e/**", "node_modules/**", "scripts/**", "test/**", "src/**/distinctiveness.test.ts", "src/**/html-parser.property.test.ts", "src/services/real-data.test.ts", "src/services/source-fidelity.corpus.test.tsx", ".claude/**", ...SLOW_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "workers-slow",
          include: SLOW_TESTS,
          // Measured at load avg ~20 on 4 CPUs: 5.7-8.6 s per test run
          // serially, 10.2 s when run alongside the full suite (where the
          // 5 s default timed out). ~3x the worst case.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
