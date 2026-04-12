import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-04-08-t', 'Bits and Bobs 4/8/24', '2024-04-08', 2024, 4, 8, 2, 'notes')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-03-25-t', 'Bits and Bobs 3/25/24', '2024-03-25', 2024, 3, 25, 1, 'essays')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-01-15-t', 'Bits and Bobs 1/15/25', '2025-01-15', 2025, 1, 15, 1, 'notes')"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedData();
});

// Unified browse page at /episodes replaces both /episodes and /timeline
describe("GET /episodes (unified browse)", () => {
  it("shows year groupings with episode counts", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should show years
    expect(html).toContain("2024");
    expect(html).toContain("2025");
  });

  it("shows episodes grouped by year and month", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    const html = await res.text();
    // Should show month names
    expect(html).toContain("April");
    expect(html).toContain("March");
    expect(html).toContain("January");
  });

  it("shows episode titles within their month groups", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    const html = await res.text();
    expect(html).toContain("Bits and Bobs 4/8/24");
    expect(html).toContain("Bits and Bobs 3/25/24");
  });

  it("shows format badges for essays", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    const html = await res.text();
    expect(html).toContain("essay");
  });
});

// Search icon in header
describe("Header search icon", () => {
  it("header contains search icon link, not text 'Search'", async () => {
    const res = await SELF.fetch("http://localhost/");
    const html = await res.text();
    // Should have a search link with icon class
    expect(html).toContain("search-icon");
    // The nav list should NOT have "Search" as a text link
    const navSection = html.split("<nav>")[1]?.split("</nav>")[0] || "";
    expect(navSection).not.toContain(">Search<");
  });
});
