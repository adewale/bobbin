import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { TopicCloud } from "../components/TopicCloud";
import { SearchForm } from "../components/SearchForm";
import { getRecentEpisodes, getChunksByEpisode, getEpisodeTopics } from "../db/episodes";
import { getTopTopics } from "../db/topics";
import { getMostConnected } from "../db/word-stats";

const home = new Hono<AppEnv>();

home.get("/", async (c) => {
  const [episodes, topics, connected] = await Promise.all([
    getRecentEpisodes(c.env.DB, 10),
    getTopTopics(c.env.DB, 20),
    getMostConnected(c.env.DB, 5),
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

      <div class="home-with-margin">
        <div class="home-main">
          {latestEp && (
            <section class="latest-episode-panel">
              <h2>
                <a href={`/episodes/${latestEp.slug}`}>
                  Latest: {latestEp.title}
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
              {latestTopics.length > 0 && (
                <aside class="latest-topics">
                  <h3>Topics</h3>
                  <div class="topics">
                    {latestTopics.slice(0, 10).map((t: any) => (
                      <a key={t.id} href={`/topics/${t.slug}`} class="topic">{t.name}</a>
                    ))}
                  </div>
                </aside>
              )}
            </section>
          )}

          <div class="home-grid">
            {connected.length > 0 && (
              <section class="most-connected">
                <h2>Most Connected</h2>
                <ul>
                  {connected.map((r: any) => (
                    <li key={r.id}>
                      <a href={`/chunks/${r.slug}`}>{r.title}</a>
                      <span class="meta">
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
                <p>No episodes yet.</p>
              )}
            </section>
          </div>
        </div>

        {topics.length > 0 && (
          <aside class="home-margin">
            <h3>Popular Topics</h3>
            <TopicCloud topics={topics} />
          </aside>
        )}
      </div>
    </Layout>
  );
});

export { home as homeRoutes };
