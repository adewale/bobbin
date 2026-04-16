import { defineConfig } from "vitest/config";

// Config for tests that need Node.js filesystem access (real data tests)
// Run with: npx vitest run --config vitest.node.config.ts
export default defineConfig({
  test: {
    include: [
      "src/**/real-data.test.ts",
      "src/**/distinctiveness.test.ts",
      "src/**/html-parser.property.test.ts",
    ],
  },
});
