import { Hono } from "hono";
import type { AppEnv, ChunkRow } from "../types";
import { Layout } from "../components/Layout";
import { SearchForm } from "../components/SearchForm";
import { ChunkCard } from "../components/ChunkCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ftsSearch, mergeAndRerank, type ScoredResult } from "../services/search";

const search = new Hono<AppEnv>();

search.get("/", async (c) => {
  const query = c.req.query("q")?.trim() || "";

  let results: ScoredResult[] = [];

  if (query) {
    // FTS5 search with field boosting (primary)
    let ftsResults: ScoredResult[] = [];
    try {
      ftsResults = await ftsSearch(c.env.DB, query);
    } catch {
      // FTS table might not exist yet — fall back to LIKE
      const kwResults = await c.env.DB.prepare(
        `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
         FROM chunks c JOIN episodes e ON c.episode_id = e.id
         WHERE c.content_plain LIKE ?
         ORDER BY e.published_date DESC LIMIT 20`
      )
        .bind(`%${query}%`)
        .all();
      ftsResults = (kwResults.results as any[]).map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        episodeSlug: r.episode_slug,
        episodeTitle: r.episode_title,
        publishedDate: r.published_date,
        summary: r.summary,
        contentPlain: r.content_plain,
        score: 0.5,
        source: "fts" as const,
      }));
    }

    // Vector search (if available)
    let vectorResults: ScoredResult[] = [];
    try {
      if (c.env.AI && c.env.VECTORIZE) {
        const embedding = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [query],
        });
        const vecResults = await c.env.VECTORIZE.query(
          (embedding as any).data[0],
          { topK: 15, returnMetadata: "all" }
        );
        if (vecResults.matches.length) {
          const vectorIds = vecResults.matches.map((m) => m.id);
          const placeholders = vectorIds.map(() => "?").join(",");
          const hydrated = await c.env.DB.prepare(
            `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
             FROM chunks c JOIN episodes e ON c.episode_id = e.id
             WHERE c.vector_id IN (${placeholders})`
          )
            .bind(...vectorIds)
            .all();

          const scoreMap = new Map(vecResults.matches.map((m) => [m.id, m.score]));
          vectorResults = (hydrated.results as any[]).map((r) => ({
            id: r.id,
            slug: r.slug,
            title: r.title,
            episodeSlug: r.episode_slug,
            episodeTitle: r.episode_title,
            publishedDate: r.published_date,
            summary: r.summary,
            contentPlain: r.content_plain,
            score: scoreMap.get(r.vector_id) || 0,
            source: "vector" as const,
          }));
        }
      }
    } catch {
      // Vector search not available
    }

    // Merge and rerank
    results = mergeAndRerank(ftsResults, vectorResults);
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
          {results.map((r) => (
            <ChunkCard
              key={r.id}
              chunk={{ id: r.id, slug: r.slug, title: r.title || "", summary: r.summary || null, content_plain: r.contentPlain || "" } as ChunkRow}
              episodeSlug={r.episodeSlug}
              episodeTitle={r.episodeTitle}
              showEpisodeLink
              query={query}
            />
          ))}
        </section>
      )}
      <script src="/scripts/search.js" defer></script>
    </Layout>
  );
});

export { search as searchRoutes };
