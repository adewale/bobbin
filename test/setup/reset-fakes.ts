import { beforeEach } from "vitest";
import { env } from "cloudflare:test";

// The AI and VECTORIZE fakes (test/fakes/) keep state for the life of the
// test runtime, while each test file rebuilds D1 before every test. Clear
// the fakes too, so vectors from one test cannot point at another test's
// rows.
beforeEach(async () => {
  await (env as any).VECTORIZE?.__reset?.();
  await (env as any).AI?.__reset?.();
});
