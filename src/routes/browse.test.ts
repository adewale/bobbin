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

// Title deduplication in accordion body
describe("Notes episode: title not repeated in accordion body", () => {
  beforeEach(async () => {
    // Chunk where title == first line of content (the real-world pattern)
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'obs-1-2024-04-08-t-0', 'LLMs are great at cheap generation.', 'LLMs are great at cheap generation.\nThey struggle with things that need deep reasoning.\nBut the gap is closing fast.', 'LLMs are great at cheap generation.\nThey struggle with things that need deep reasoning.\nBut the gap is closing fast.', 0)`
    ).run();
    // Chunk where title does NOT match first line (edge case — should keep all content)
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'obs-2-2024-04-08-t-1', 'Agents and autonomy', 'Autonomous agents are the next frontier.\nThey need guardrails though.', 'Autonomous agents are the next frontier.\nThey need guardrails though.', 1)`
    ).run();
  });

  it("strips the first line when it matches the title", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08-t");
    const html = await res.text();
    // Title appears in summary
    expect(html).toContain("LLMs are great at cheap generation.");
    // Body should have the sub-points but NOT repeat the title as a <p>
    const bodySection = html.split("obs-content")[1] || "";
    expect(bodySection).toContain("They struggle with things that need deep reasoning.");
    expect(bodySection).toContain("But the gap is closing fast.");
    // Count occurrences of the title text — should appear once (in summary), not twice
    const titleText = "LLMs are great at cheap generation.";
    const occurrences = html.split(titleText).length - 1;
    expect(occurrences).toBe(1);
  });

  it("keeps all content when title differs from first line", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-04-08-t");
    const html = await res.text();
    // The second chunk's body should keep its first line since title != first line
    expect(html).toContain("Autonomous agents are the next frontier.");
  });
});

// Essay episodes: title deduplication must NOT apply
describe("Essay episode: full content preserved", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (2, 'essay-1-2024-03-25-t-0', 'Consumer AI is converging', 'Consumer AI is converging\nThe big players are all building the same thing.\nDifferentiation is shrinking.', 'Consumer AI is converging\nThe big players are all building the same thing.\nDifferentiation is shrinking.', 0)`
    ).run();
  });

  it("does not strip any content from essay chunks", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2024-03-25-t");
    const html = await res.text();
    // Essay renders all content including first line (title is an <h2>, content is separate)
    expect(html).toContain("Consumer AI is converging");
    expect(html).toContain("The big players are all building the same thing.");
    expect(html).toContain("Differentiation is shrinking.");
    // The title text should appear at least twice: once in <h2>, once in content
    const titleText = "Consumer AI is converging";
    const occurrences = html.split(titleText).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
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
