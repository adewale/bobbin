import { defineConfig } from "vitest/config";

// Config for tests that need Node.js filesystem access (real data tests)
// Run with: npx vitest run --config vitest.node.config.ts
export default defineConfig({
  test: {
    minWorkers: 1,
    maxWorkers: 1,
    include: [
      "scripts/**/*.test.ts",
      "src/**/real-data.test.ts",
      "src/**/distinctiveness.test.ts",
      "src/**/html-parser.property.test.ts",
      "src/**/source-fidelity.corpus.test.tsx",
    ],
  },
});
