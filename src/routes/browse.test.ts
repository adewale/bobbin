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

// Notes episode: chunk rendering
describe("Notes episode: chunk list rendering", () => {
  beforeEach(async () => {
    // Multi-line chunk (has body after title strip)
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'multi-2024-04-08-t-0', 'LLMs are great at cheap generation.', 'LLMs are great at cheap generation.\nThey struggle with things that need deep reasoning.\nBut the gap is closing fast.', 'LLMs are great at cheap generation.\nThey struggle with things that need deep reasoning.\nBut the gap is closing fast.', 0)`
    ).run();
    // Single-line chunk (no body after title strip)
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'single-2024-04-08-t-1', 'Lower pace layers should be boring.', 'Lower pace layers should be boring.', 'Lower pace layers should be boring.', 1)`
    ).run();
  });

  it("multi-line chunk uses accordion with title not repeated in body", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08-t");
    const html = await res.text();
    // Title appears once, not duplicated
    const titleText = "LLMs are great at cheap generation.";
    const occurrences = html.split(titleText).length - 1;
    expect(occurrences).toBe(1);
    // Body content is present
    expect(html).toContain("They struggle with things that need deep reasoning.");
    expect(html).toContain("chunk-body");
  });

  it("single-line chunk renders as plain row, not accordion", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08-t");
    const html = await res.text();
    // Should have the single-line class, not a <details> accordion
    expect(html).toContain("chunk-row-single");
    expect(html).toContain("Lower pace layers should be boring.");
  });

  it("chunk number links to chunk detail page", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08-t");
    const html = await res.text();
    // Both chunk numbers should be links to their chunk pages
    expect(html).toContain('href="/chunks/multi-2024-04-08-t-0"');
    expect(html).toContain('href="/chunks/single-2024-04-08-t-1"');
  });
});

// Essay episode: title dedup
describe("Essay episode: title not repeated in body", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (2, 'essay-1-2024-03-25-t-0', 'Consumer AI is converging', 'Consumer AI is converging\nThe big players are all building the same thing.\nDifferentiation is shrinking.', 'Consumer AI is converging\nThe big players are all building the same thing.\nDifferentiation is shrinking.', 0)`
    ).run();
  });

  it("strips duplicate title but preserves essay body content", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-03-25-t");
    const html = await res.text();
    expect(html).toContain("The big players are all building the same thing.");
    expect(html).toContain("Differentiation is shrinking.");
    const titleText = "Consumer AI is converging";
    const occurrences = html.split(titleText).length - 1;
    expect(occurrences).toBe(1);
  });
});

// Chunk detail page: title dedup
describe("Chunk detail page: title not repeated in body", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'multi-2024-04-08-t-0', 'LLMs are great at cheap generation.', 'LLMs are great at cheap generation.\nThey struggle with things that need deep reasoning.', 'LLMs are great at cheap generation.\nThey struggle with things that need deep reasoning.', 0)`
    ).run();
  });

  it("strips duplicate title from chunk body", async () => {
    const res = await SELF.fetch("http://localhost/chunks/multi-2024-04-08-t-0");
    const html = await res.text();
    expect(html).toContain("They struggle with things that need deep reasoning.");
    const inBody = html.split("chunk-content")[1] || "";
    expect(inBody).not.toContain(`<p>LLMs are great at cheap generation.</p>`);
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
