import { Hono } from "hono";
import type { AppEnv, ChunkRow } from "../types";
import { Layout } from "../components/Layout";
import { SearchForm } from "../components/SearchForm";
import { ChunkCard } from "../components/ChunkCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ftsSearch, mergeAndRerank, type ScoredResult } from "../services/search";
import { parseSearchQuery } from "../lib/query-parser";
import { keywordSearch } from "../db/search";
import { applyTopicBoost } from "../services/search-topics";
import { expandEntityAliases } from "../lib/entity-aliases";
import { KNOWN_ENTITIES } from "../data/known-entities";

const search = new Hono<AppEnv>();

search.get("/", async (c) => {
  const query = c.req.query("q")?.trim() || "";

  let results: ScoredResult[] = [];

  if (query) {
    const parsed = parseSearchQuery(query);

    // Entity alias expansion: if query matches a known entity, expand to include all aliases.
    // Each term is individually quoted so FTS5 treats multi-word names as phrases
    // and the OR operators remain at the top level (not inside a phrase literal).
    const entityAliases = expandEntityAliases(parsed.text, KNOWN_ENTITIES);
    if (entityAliases.length > 0) {
      const uniqueTerms = new Set([
        parsed.text.toLowerCase(),
        ...entityAliases,
      ]);
      parsed.text = [...uniqueTerms]
        .filter(Boolean)
        .map((t) => (t.includes(" ") ? `"${t}"` : t))
        .join(" OR ");
    }

    // FTS5 search with field boosting + date filters (primary)
    let ftsResults: ScoredResult[] = [];
    try {
      ftsResults = await ftsSearch(c.env.DB, parsed);
    } catch {
      // FTS table might not exist yet — fall back to keyword search
      const kwResults = await keywordSearch(c.env.DB, parsed);
      ftsResults = kwResults.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        episodeSlug: r.episode_slug,
        episodeTitle: r.episode_title,
        publishedDate: r.published_date,
        summary: r.summary ?? undefined,
        contentPlain: r.content_plain,
        score: 0.5,
        source: "fts" as const,
      }));
    }

    // Vector search (if available) — skip for exact phrase queries
    // Quoted phrases signal precision intent; vector search adds noise
    const hasExactPhrase = parsed.phrases.length > 0;
    let vectorResults: ScoredResult[] = [];
    try {
      if (c.env.AI && c.env.VECTORIZE && !hasExactPhrase) {
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
          // Filter by minimum cosine similarity — low scores are noise
          const MIN_VECTOR_SCORE = 0.72;
          vectorResults = (hydrated.results as any[])
            .filter((r) => (scoreMap.get(r.vector_id) || 0) >= MIN_VECTOR_SCORE)
            .map((r) => ({
              id: r.id,
              slug: r.slug,
              title: r.title,
              episodeSlug: r.episode_slug,
              episodeTitle: r.episode_title,
              publishedDate: r.published_date,
              summary: r.summary ?? undefined,
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

    // Topic boost: if query text matches a topic, boost chunks assigned to it
    if (parsed.text) {
      results = await applyTopicBoost(c.env.DB, parsed.text, results);
    }
  }

  return c.html(
    <Layout
      title={query ? `Search: ${query}` : "Search"}
      description="Search the Bits and Bobs archive"
      activePath="/search"
    >
      <SearchForm query={query} autofocus />

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
