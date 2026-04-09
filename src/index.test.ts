import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../test/helpers/migrations";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("Bobbin smoke test", () => {
  it("GET / returns 200", async () => {
    const response = await SELF.fetch("http://localhost/");
    expect(response.status).toBe(200);
  });

  it("GET / returns HTML", async () => {
    const response = await SELF.fetch("http://localhost/");
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
