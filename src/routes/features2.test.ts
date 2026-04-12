import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-01-15', 'Bits and Bobs 1/15/24', '2024-01-15', 2024, 1, 15, 1)"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, '2024-03-18', 'Bits and Bobs 3/18/24', '2024-03-18', 2024, 3, 18, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'eco-jan', 'Ecosystem growth', 'Ecosystems grow organically.', 'Ecosystems grow organically.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'eco-mar', 'Ecosystem decline', 'Ecosystems can collapse under pressure.', 'Ecosystems can collapse under pressure.', 0)"),
    env.DB.prepare("INSERT INTO tags (name, slug, usage_count) VALUES ('ecosystem', 'ecosystem', 2)"),
    env.DB.prepare("INSERT INTO chunk_tags (chunk_id, tag_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_tags (chunk_id, tag_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO episode_tags (episode_id, tag_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_tags (episode_id, tag_id) VALUES (2, 1)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedData();
});

// === Feature 4: Diff-over-time view ===
describe("GET /tags/:slug/diff", () => {
  it("returns 200 with chronological chunks for comparison", async () => {
    const res = await SELF.fetch("http://localhost/tags/ecosystem/diff");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("diff-view");
    expect(html).toContain("Ecosystem growth");
    expect(html).toContain("Ecosystem decline");
  });

  it("shows chunks in chronological order", async () => {
    const res = await SELF.fetch("http://localhost/tags/ecosystem/diff");
    const html = await res.text();
    const janIdx = html.indexOf("2024-01-15");
    const marIdx = html.indexOf("2024-03-18");
    expect(janIdx).toBeLessThan(marIdx);
  });
});

// === Feature 10: Mobile reading mode ===
// Reading mode only shows on essay-format chunks (tested in tag-layout.test.ts)
