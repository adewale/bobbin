import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { TagCloud } from "../components/TagCloud";
import { SearchForm } from "../components/SearchForm";
import { getRecentEpisodes } from "../db/episodes";
import { getTopTags } from "../db/tags";
import { getMostConnected } from "../db/concordance";

const home = new Hono<AppEnv>();

home.get("/", async (c) => {
  const [episodes, tags, connected] = await Promise.all([
    getRecentEpisodes(c.env.DB, 10),
    getTopTags(c.env.DB, 30),
    getMostConnected(c.env.DB, 8),
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

      {connected.length > 0 && (
        <section class="most-connected">
          <h2>Most Connected</h2>
          <p class="section-subtitle">Observations that echo across multiple episodes</p>
          <ul>
            {connected.map((r: any) => (
              <li key={r.id}>
                <a href={`/chunks/${r.slug}`}>{r.title}</a>
                <span class="meta">
                  {r.reach} reach &middot;{" "}
                  <a href={`/episodes/${r.episode_slug}`}>{r.published_date}</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="recent-episodes">
        <h2>Recent Episodes</h2>
        {episodes.map((ep) => (
          <EpisodeCard key={ep.id} episode={ep} />
        ))}
        {episodes.length > 0 && (
          <a href="/episodes" class="see-all">See all episodes &rarr;</a>
        )}
        {episodes.length === 0 && (
          <p>No episodes yet. Content will be ingested soon.</p>
        )}
      </section>

      {tags.length > 0 && (
        <section class="tag-section">
          <h2>Popular Tags</h2>
          <TagCloud tags={tags} />
        </section>
      )}
    </Layout>
  );
});

export { home as homeRoutes };
