import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import fc from "fast-check";
import { applyTestMigrations } from "../../test/helpers/migrations";

async function seedLayoutData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('layout-doc', 'Layout Doc')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2026-04-14-layout', 'Bits and Bobs 4/14/26', '2026-04-14', 2026, 4, 14, 2, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2026-04-07-layout', 'Bits and Bobs 4/7/26', '2026-04-07', 2026, 4, 7, 1, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'swarm-sifting-layout-1', 'Swarm Sifting Sort', 'Swarm Sifting Sort\nRanking systems work when authentic user actions accumulate into shared signal.', 'Ranking systems work when authentic user actions accumulate into shared signal.', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (2, 'swarm-sifting-layout-2', 'Folksonomy drift', 'Folksonomy drift\nTags become more useful when they evolve through repeated real-world use.', 'Tags become more useful when they evolve through repeated real-world use.', 0)"
    ),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('swarm sifting', 'swarm-sifting', 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)"),
    env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (2, 1)"),
    env.DB.prepare(
      "INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES ('swarm sifting', 2, 2, 9.2, 0)"
    ),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedLayoutData();
});

describe("Header and page search affordances", () => {
  it("renders both header search and page-local search on the dedicated search page", async () => {
    const res = await SELF.fetch("http://localhost/search?q=swarm");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('class="header-search"');
    expect(html).toContain('class="search-form"');
    expect((html.match(/name="q"/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("uses header search rather than an inline search form on the topics index", async () => {
    const res = await SELF.fetch("http://localhost/topics");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('class="header-search"');
    expect(html).not.toContain('class="search-form"');
    expect(html).toContain('class="main-wide"');
  });
});

describe("Wider canvas adoption", () => {
  it("uses the wider canvas on the search page without forcing a rail", async () => {
    const res = await SELF.fetch("http://localhost/search?q=swarm");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('class="main-wide"');
    expect(html).not.toContain("page-with-rail");
    expect(html).toContain("page-shell");
    expect(html).toContain("page-body-single");
  });

  it("keeps chunk cards as the only search results mode", async () => {
    const res = await SELF.fetch("http://localhost/search?q=ranking");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('class="chunk-card"');
    expect(html).not.toContain('class="search-browse-results"');
    expect(html).not.toContain('class="search-view-switch"');
  });

  it("uses the shared rail-panel system on the episodes index", async () => {
    const res = await SELF.fetch("http://localhost/episodes");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("browse-rail");
    expect(html).toContain("rail-stack");
    expect(html).toContain("rail-panel");
    expect(html).toContain('class="page-toc rail-panel"');
    expect(html).toContain('aria-current="true"');
  });
});

describe("Topic page layout safety", () => {
  it("uses a topic-specific layout wrapper instead of a global page rail", async () => {
    const res = await SELF.fetch("http://localhost/topics/swarm-sifting");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("page-with-rail");
    expect(html).toContain("page-with-rail--aligned");
    expect(html).toContain("page-rail");
    expect(html).toContain("topic-detail-layout");
    expect(html).toContain("topic-page-rail");
    expect(html).toContain("page-preamble");
  });
});

describe("Search query round-tripping (PBT)", () => {
  it("echoes safe query strings into both search controls", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[A-Za-z0-9](?:[A-Za-z0-9 ]{0,22}[A-Za-z0-9])?$/),
        async (query) => {
          const res = await SELF.fetch(`http://localhost/search?q=${encodeURIComponent(query)}`);
          const html = await res.text();

          expect(res.status).toBe(200);
          expect(html).toContain(`value="${query}"`);
          expect((html.match(/name="q"/g) || []).length).toBeGreaterThanOrEqual(2);
        }
      )
    );
  });
});
