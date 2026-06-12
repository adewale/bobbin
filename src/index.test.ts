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

describe("Security response headers", () => {
  it("serves HTML pages with CSP, nosniff, and frame protection", async () => {
    const response = await SELF.fetch("http://localhost/");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const csp = response.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
  });

  it("serves JSON API responses with nosniff and without the public HTML cache header", async () => {
    const response = await SELF.fetch("http://localhost/api/topics?q=ec");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control") ?? "").not.toContain("s-maxage=3600");
  });

  it("still applies the public cache header to GET HTML pages", async () => {
    const response = await SELF.fetch("http://localhost/");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=3600");
  });
});

describe("Admin endpoint methods", () => {
  it("does not expose destructive admin operations as GET routes", async () => {
    (env as any).ADMIN_SECRET = "test-secret";
    for (const path of ["/api/ingest", "/api/refresh", "/api/purge-source", "/api/finalize", "/api/cleanup-stale"]) {
      const res = await SELF.fetch(`http://localhost${path}`, {
        headers: { Authorization: "Bearer test-secret" },
      });
      expect(res.status, `${path} must not be reachable via GET`).toBe(404);
    }
  });
});
