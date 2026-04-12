import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { TopicCloud } from "../components/TopicCloud";
import { SearchForm } from "../components/SearchForm";
import { ThemeRiver } from "../components/ThemeRiver";
import { getRecentEpisodes, getChunksByEpisode, getEpisodeTopics } from "../db/episodes";
import { getTopTopics, getThemeRiverData } from "../db/topics";
import { getMostConnected } from "../db/word-stats";

const home = new Hono<AppEnv>();

home.get("/", async (c) => {
  const [episodes, topics, connected, themeRiver] = await Promise.all([
    getRecentEpisodes(c.env.DB, 10),
    getTopTopics(c.env.DB, 30),
    getMostConnected(c.env.DB, 8),
    getThemeRiverData(c.env.DB, 6),
  ]);

  const latestEp = episodes[0];
  let latestChunks: any[] = [];
  let latestTopics: any[] = [];
  if (latestEp) {
    [latestChunks, latestTopics] = await Promise.all([
      getChunksByEpisode(c.env.DB, latestEp.id),
      getEpisodeTopics(c.env.DB, latestEp.id),
    ]);
  }

  return c.html(
    <Layout
      title="Home"
      description="An archive of Alex Komoroske's Bits and Bobs weekly newsletter"
    >
      <section class="hero">
        <p>
          A searchable archive of Alex Komoroske's{" "}
          <em>Bits and Bobs</em> weekly newsletter.
        </p>
        <SearchForm />
      </section>

      {latestEp && (
        <section class="latest-episode-panel">
          <div class="latest-content">
            <h2>
              <a href={`/episodes/${latestEp.slug}`}>
                Latest: {latestEp.title} &middot; {latestEp.chunk_count} chunks
              </a>
            </h2>
            <ul class="latest-chunks">
              {latestChunks.slice(0, 5).map((chunk: any) => (
                <li key={chunk.id}>{chunk.title}</li>
              ))}
            </ul>
            <a href={`/episodes/${latestEp.slug}`} class="see-all">
              See all {latestEp.chunk_count} chunks &rarr;
            </a>
          </div>
          {latestTopics.length > 0 && (
            <aside class="latest-topics">
              <h3>Topics</h3>
              <div class="topics">
                {latestTopics.map((t: any) => (
                  <a key={t.id} href={`/topics/${t.slug}`} class="topic">{t.name}</a>
                ))}
              </div>
            </aside>
          )}
        </section>
      )}

      <ThemeRiver data={themeRiver.data} dates={themeRiver.episodes} />

      <div class="home-grid">
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

        {topics.length > 0 && (
          <section class="topic-section">
            <h2>Popular Topics</h2>
            <TopicCloud topics={topics} />
          </section>
        )}
      </div>
    </Layout>
  );
});

export { home as homeRoutes };
