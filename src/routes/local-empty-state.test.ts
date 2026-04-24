import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("Empty local archive states", () => {
  it("shows a helpful setup message on the homepage when the archive is empty", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("No archive data loaded yet.");
    expect(html).toContain("npm run fixture:local");
  });

  it("shows a helpful setup message on the episodes index when the archive is empty", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("No episodes are available yet.");
    expect(html).toContain("npm run fixture:local");
  });

  it("shows a helpful setup message on the topics index when the archive is empty", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("No topics are available yet.");
    expect(html).toContain("npm run fixture:local");
  });
});
