import { describe, expect, it } from "vitest";
import { FULL_PRODUCT_LOCAL_FIXTURE_COMMAND, LOCAL_DEV_WRANGLER_CONFIG_PATH } from "./local-dev-config";

describe("local dev config", () => {
  it("points local bootstrap scripts at wrangler.jsonc by default", () => {
    expect(LOCAL_DEV_WRANGLER_CONFIG_PATH).toBe("./wrangler.jsonc");
  });

  it("defines a canonical full-product fixture command", () => {
    expect(FULL_PRODUCT_LOCAL_FIXTURE_COMMAND).toBe("npm run fixture:local");
  });
});
