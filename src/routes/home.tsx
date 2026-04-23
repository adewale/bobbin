import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { getRecentEpisodes, getChunksByEpisode, getEpisodeTopics, getNovelTopicHistory } from "../db/episodes";
import { getTopTopics } from "../db/topics";
import { getMostConnected } from "../db/word-stats";

const home = new Hono<AppEnv>();

function HelpTip(props: { label: string; text: string }) {
  return (
    <details class="topic-help-tip">
      <summary aria-label={props.label} title={props.label}>?</summary>
      <div class="topic-help-tip-bubble" role="note">{props.text}</div>
    </details>
  );
}

home.get("/", async (c) => {
  const [episodes, topics, connected, novelTopicHistory] = await Promise.all([
    getRecentEpisodes(c.env.DB, 10),
    getTopTopics(c.env.DB, 20),
    getMostConnected(c.env.DB, 5),
    getNovelTopicHistory(c.env.DB, 16),
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
      <div class="page-with-rail page-with-rail--aligned home-with-margin">
        <div class="page-body home-main">
          <section class="page-preamble hero">
            <p>
              A searchable archive of Alex Komoroske's{" "}
              <em>Bits and Bobs</em> weekly newsletter.
            </p>
          </section>

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

        <aside class="page-rail home-margin rail-stack">
          <section class="recent-episodes rail-panel rail-panel-list">
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
            <section class="margin-topics rail-panel">
              <h3>Popular Topics</h3>
              <div class="rail-panel-list topics-list">
                <ul>
                  {topics.map((topic) => (
                    <li key={topic.id}>
                      <a href={`/topics/${topic.slug}`}>{topic.name}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {novelTopicHistory.length > 1 && (() => {
            const width = 180;
            const height = 42;
            const pad = 8;
            const maxNovel = Math.max(...novelTopicHistory.map((point) => point.novel_topics), 1);
            const points = novelTopicHistory.map((point, index) => ({
              ...point,
              x: novelTopicHistory.length === 1
                ? width / 2
                : pad + (index / Math.max(novelTopicHistory.length - 1, 1)) * (width - pad * 2),
              y: height - pad - (point.novel_topics / maxNovel) * (height - pad * 2),
            }));

            return (
              <section class="rail-panel home-novel-topic-history">
                <div class="rail-panel-heading-row">
                  <h3>Novel Topic History</h3>
                  <HelpTip
                    label="Explain novel topic history"
                    text="New-to-corpus topics per episode. Higher points mean more topics appeared for the first time in Bobbin in that episode."
                  />
                </div>
                <svg viewBox={`0 0 ${width} ${height + 14}`} class="rail-sparkline" role="img" aria-label="Novel topics per episode">
                  <polyline
                    points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke="var(--rail-signal-color)"
                    stroke-width="2"
                  />
                  {points.map((point, index) => (
                    <g key={`novel-topic-${point.slug}`}>
                      <circle cx={point.x} cy={point.y} r="2.5" fill="var(--rail-signal-color)">
                        <title>{`${point.title}: ${point.novel_topics} new topic${point.novel_topics === 1 ? "" : "s"}`}</title>
                      </circle>
                      {(index === 0 || index === points.length - 1) && (
                        <text x={point.x} y={height + 11} text-anchor="middle" fill="var(--rail-meta-color)" font-size="8" font-family="var(--font-ui)">
                          {point.published_date.slice(5)}
                        </text>
                      )}
                    </g>
                  ))}
                </svg>
              </section>
            );
          })()}
        </aside>
      </div>
    </Layout>
  );
});

export { home as homeRoutes };
