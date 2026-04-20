import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { TopicCloud } from "../components/TopicCloud";
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
      mainClassName="main-wide"
    >
      <section class="hero">
        <p>
          A searchable archive of Alex Komoroske's{" "}
          <em>Bits and Bobs</em> weekly newsletter.
        </p>
      </section>

      <div class="page-with-rail home-with-margin">
        <div class="page-body home-main">
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
        </div>

        <aside class="page-rail home-margin">
          <section class="recent-episodes">
            <h3>Recent Episodes</h3>
            {episodes.slice(0, 8).map((ep) => (
              <a key={ep.id} href={`/episodes/${ep.slug}`} class="recent-ep-link">
                <time>{ep.published_date}</time>
                <span>{ep.chunk_count}</span>
              </a>
            ))}
            <a href="/episodes" class="see-all">All episodes &rarr;</a>
          </section>

          {topics.length > 0 && (
            <section class="margin-topics">
              <h3>Popular Topics</h3>
              <TopicCloud topics={topics} />
            </section>
          )}
        </aside>
      </div>
    </Layout>
  );
});

export { home as homeRoutes };
