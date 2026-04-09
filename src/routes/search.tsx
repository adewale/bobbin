import { Hono } from "hono";
import type { AppEnv, ChunkRow } from "../types";
import { Layout } from "../components/Layout";
import { SearchForm } from "../components/SearchForm";
import { ChunkCard } from "../components/ChunkCard";
import { Breadcrumbs } from "../components/Breadcrumbs";

const search = new Hono<AppEnv>();

search.get("/", async (c) => {
  const query = c.req.query("q")?.trim() || "";

  let results: any[] = [];

  if (query) {
    // Keyword search (semantic search requires AI binding)
    const kwResults = await c.env.DB.prepare(
      `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
       FROM chunks c
       JOIN episodes e ON c.episode_id = e.id
       WHERE c.content_plain LIKE ?
       ORDER BY e.published_date DESC
       LIMIT 20`
    )
      .bind(`%${query}%`)
      .all();

    results = kwResults.results as any[];

    // Try semantic search if AI and Vectorize are available
    try {
      if (c.env.AI && c.env.VECTORIZE) {
        const embedding = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [query],
        });
        const vectorResults = await c.env.VECTORIZE.query(
          (embedding as any).data[0],
          { topK: 15, returnMetadata: "all" }
        );
        if (vectorResults.matches.length) {
          const vectorIds = vectorResults.matches.map((m) => m.id);
          const placeholders = vectorIds.map(() => "?").join(",");
          const semanticResults = await c.env.DB.prepare(
            `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
             FROM chunks c JOIN episodes e ON c.episode_id = e.id
             WHERE c.vector_id IN (${placeholders})`
          )
            .bind(...vectorIds)
            .all();

          // Merge, dedup
          const seen = new Set(results.map((r: any) => r.id));
          for (const r of semanticResults.results as any[]) {
            if (!seen.has(r.id)) {
              results.push(r);
              seen.add(r.id);
            }
          }
        }
      }
    } catch {
      // AI/Vectorize not available — keyword results only
    }
  }

  return c.html(
    <Layout
      title={query ? `Search: ${query}` : "Search"}
      description="Search the Bits and Bobs archive"
    >
      <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Search" }]} />
      <h1>Search</h1>
      <SearchForm query={query} />

      {query && (
        <section class="search-results">
          <p>
            {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
          </p>
          {results.map((r: any) => (
            <ChunkCard
              key={r.id}
              chunk={r as ChunkRow}
              episodeSlug={r.episode_slug}
              episodeTitle={r.episode_title}
              showEpisodeLink
            />
          ))}
        </section>
      )}
      <script src="/scripts/search.js" defer></script>
    </Layout>
  );
});

export { search as searchRoutes };
