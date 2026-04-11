import { Hono } from "hono";
import type { AppEnv, EpisodeRow, TagRow } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { TagCloud } from "../components/TagCloud";
import { SearchForm } from "../components/SearchForm";

const home = new Hono<AppEnv>();

home.get("/", async (c) => {
  const [episodes, tags, connected] = await Promise.all([
    c.env.DB.prepare(
      "SELECT * FROM episodes ORDER BY published_date DESC LIMIT 10"
    ).all(),
    c.env.DB.prepare(
      "SELECT * FROM tags WHERE usage_count > 0 ORDER BY usage_count DESC LIMIT 30"
    ).all(),
    // Most-connected: chunks that share the most tags with other chunks across episodes
    c.env.DB.prepare(
      `SELECT c.id, c.slug, c.title, c.content_plain,
              e.slug as episode_slug, e.title as episode_title, e.published_date,
              COUNT(DISTINCT ct2.chunk_id) as connections
       FROM chunks c
       JOIN chunk_tags ct1 ON c.id = ct1.chunk_id
       JOIN chunk_tags ct2 ON ct1.tag_id = ct2.tag_id AND ct2.chunk_id != c.id
       JOIN chunks c2 ON ct2.chunk_id = c2.id AND c2.episode_id != c.episode_id
       JOIN episodes e ON c.episode_id = e.id
       GROUP BY c.id
       ORDER BY connections DESC
       LIMIT 8`
    ).all(),
  ]);

  return c.html(
    <Layout
      title="Home"
      description="An archive of Alex Komoroske's Bits and Bobs weekly newsletter"
    >
      <section class="hero">
        <h1>Bobbin</h1>
        <p>
          A searchable archive of Alex Komoroske's{" "}
          <em>Bits and Bobs</em> weekly observations.
        </p>
        <SearchForm />
      </section>

      {(connected.results as any[]).length > 0 && (
        <section class="most-connected">
          <h2>Most Connected</h2>
          <p class="section-subtitle">Observations that echo across multiple episodes</p>
          <ul>
            {(connected.results as any[]).map((r) => (
              <li key={r.id}>
                <a href={`/chunks/${r.slug}`}>{r.title}</a>
                <span class="meta">
                  {r.connections} connections &middot;{" "}
                  <a href={`/episodes/${r.episode_slug}`}>{r.published_date}</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="recent-episodes">
        <h2>Recent Episodes</h2>
        {(episodes.results as unknown as EpisodeRow[]).map((ep) => (
          <EpisodeCard key={ep.id} episode={ep} />
        ))}
        {episodes.results.length > 0 && (
          <a href="/episodes" class="see-all">See all episodes &rarr;</a>
        )}
        {episodes.results.length === 0 && (
          <p>No episodes yet. Content will be ingested soon.</p>
        )}
      </section>

      {(tags.results as unknown as TagRow[]).length > 0 && (
        <section class="tag-section">
          <h2>Popular Tags</h2>
          <TagCloud tags={tags.results as unknown as TagRow[]} />
        </section>
      )}
    </Layout>
  );
});

export { home as homeRoutes };
