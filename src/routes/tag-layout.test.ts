import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    // Essay episode
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-04-08-t', 'Ep1', '2024-04-08', 2024, 4, 8, 1, 'essays')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'essay-chunk', 'Essay chunk', 'Rich content here.\nWith multiple lines.\nAnd depth.', 'Rich content here. With multiple lines. And depth.', 0)"),
    // Notes episode
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-05-01-t', 'Ep2', '2024-05-01', 2024, 5, 1, 1, 'notes')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'note-chunk', 'Note chunk', 'Brief thought.', 'Brief thought.', 0)"),
    // Tags
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

describe("Tag layout on chunk pages", () => {
  it("tags are wrapped in tags-margin class for Tufte sidebar positioning", async () => {
    const res = await SELF.fetch("http://localhost/chunks/essay-chunk");
    const html = await res.text();
    expect(html).toContain("tags-margin");
  });

  it("topics are shown as always-visible marginalia with h3 heading", async () => {
    const res = await SELF.fetch("http://localhost/chunks/essay-chunk");
    const html = await res.text();
    const marginStart = html.indexOf("tags-margin");
    const marginEnd = html.indexOf("</aside>", marginStart);
    const marginSection = html.substring(marginStart, marginEnd);
    expect(marginSection).toContain("<h3>Topics</h3>");
    expect(marginSection).not.toContain("<details");
    expect(marginSection).not.toContain("<summary");
  });
});

describe("Tag layout on episode pages", () => {
  it("essay episode has tags in tags-margin wrapper", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08-t");
    const html = await res.text();
    expect(html).toContain("tags-margin");
  });
});

