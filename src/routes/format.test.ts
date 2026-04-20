import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
    // Essay-format episode (few chunks, rich content)
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2026-03-30', 'Bits and Bobs 3/30/2026', '2026-03-30', 2026, 3, 30, 3, 'essays')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'essay-1', 'Consumer AI is being absorbed', 'Consumer AI is being absorbed.\nOn the consumer side, distribution incumbents are swallowing standalone AI apps.\nOn the enterprise side, OpenAI just declared code red.', 'Consumer AI is being absorbed. On the consumer side, distribution incumbents are swallowing standalone AI apps. On the enterprise side, OpenAI just declared code red.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'essay-2', 'Meta bet on personal software', 'Meta just acqui-hired both Gizmo and Dreamer.\nThe further you push this, the more it depends on knowing who you are.\nMeta wants to own the whole stack.', 'Meta just acqui-hired both Gizmo and Dreamer. The further you push this, the more it depends on knowing who you are. Meta wants to own the whole stack.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'essay-3', 'Vertical AI is the third path', 'If consumer gets absorbed and enterprise consolidates, vertical AI is the third path.\nThis connects to last week note on vertical AI.\nThe test: is the intelligence compounding.', 'If consumer gets absorbed and enterprise consolidates, vertical AI is the third path. This connects to last week note on vertical AI. The test: is the intelligence compounding.', 2)"),
    // Notes-format episode (many brief chunks)
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2026-04-06', 'Bits and Bobs 4/6/26', '2026-04-06', 2026, 4, 6, 15, 'notes')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'note-1', 'Selling software vs outcomes', 'Are you selling the software or the thing it accomplishes?', 'Are you selling the software or the thing it accomplishes?', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'note-2', 'LLMs and house fires', 'Improving software with LLMs is like adding a room to a burning house.', 'Improving software with LLMs is like adding a room to a burning house.', 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'note-3', 'Standing out from the average', 'You have to stand out from the average.', 'You have to stand out from the average.', 2)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedData();
});

describe("Essay-format episode rendering", () => {
  it("shows full content inline with episode-essays class", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2026-03-30");
    const html = await res.text();
    expect(html).toContain("episode-essays");
    // Full chunk content should be visible
    expect(html).toContain("distribution incumbents");
    expect(html).toContain("acqui-hired");
  });

  it("does NOT show episode-chunks for essays", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2026-03-30");
    const html = await res.text();
    expect(html).not.toContain("episode-chunks");
  });
});

describe("Notes-format episode rendering", () => {
  it("shows TOC with episode-chunks class", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2026-04-06");
    const html = await res.text();
    expect(html).toContain("episode-chunks");
  });

  it("does NOT show full content inline", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2026-04-06");
    const html = await res.text();
    expect(html).not.toContain("episode-essays");
  });
});

describe("Notes-format chunk page", () => {
  it("shows compact layout without tufte-layout", async () => {
    const res = await SELF.fetch("http://localhost/chunks/note-1");
    const html = await res.text();
    expect(html).toContain('class="main-wide"');
    expect(html).not.toContain("page-with-rail");
    expect(html).toContain("chunk-compact");
    expect(html).not.toContain("tufte-layout");
  });

  it("shows prev/next navigation within episode", async () => {
    const res = await SELF.fetch("http://localhost/chunks/note-2");
    const html = await res.text();
    expect(html).toContain("chunk-nav");
    expect(html).toContain("note-1"); // prev
    expect(html).toContain("note-3"); // next
  });
});

describe("Essay-format chunk page", () => {
  it("shows rich tufte-layout", async () => {
    const res = await SELF.fetch("http://localhost/chunks/essay-1");
    const html = await res.text();
    expect(html).toContain('class="main-wide"');
    expect(html).not.toContain("page-with-rail");
    expect(html).toContain("tufte-layout");
    expect(html).not.toContain("chunk-compact");
  });
});

describe("Episodes index layout", () => {
  it("uses the wider canvas without a forced rail", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    const html = await res.text();
    expect(html).toContain('class="main-wide"');
    expect(html).not.toContain("page-with-rail");
  });
});
