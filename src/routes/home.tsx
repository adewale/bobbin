import { Hono } from "hono";
import type { AppEnv } from "../types";
import { BrowseRow } from "../components/BrowseIndex";
import { EmptyArchiveState } from "../components/EmptyArchiveState";
import { HelpTip } from "../components/HelpTip";
import { Layout } from "../components/Layout";
import { TopicChartPanel } from "../components/TopicChartPanel";
import { TopicRailList } from "../components/TopicRailList";
import { TopicStrip } from "../components/TopicStrip";
import { getRecentEpisodes, getChunksByEpisode, getEpisodeTopics, getNovelTopicHistory } from "../db/episodes";
import { getTopTopics } from "../db/topics";
import { getMostConnected } from "../db/word-stats";

const home = new Hono<AppEnv>();

home.get("/", async (c) => {
  const [episodes, topics, connected, novelTopicHistory] = await Promise.all([
    getRecentEpisodes(c.env.DB, 10),
    getTopTopics(c.env.DB, 20),
    getMostConnected(c.env.DB, 5),
    getNovelTopicHistory(c.env.DB),
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
  const hasHomeRail = episodes.length > 0 || topics.length > 0 || novelTopicHistory.length > 1;
  const homeLayoutClass = hasHomeRail ? "page-with-rail page-with-rail--aligned home-with-margin" : "page-shell";
  const homeBodyClass = hasHomeRail ? "page-body home-main" : "page-body page-body-single home-main";

  return c.html(
    <Layout
      title="Home"
      description="An archive of Alex Komoroske's Bits and Bobs weekly newsletter"
      mainClassName="main-wide"
    >
      <div class={homeLayoutClass}>
        <div class={homeBodyClass}>
          <section class="page-preamble hero">
            <p class="page-tagline">
              A searchable archive of Alex Komoroske's{" "}
              <em>Bits and Bobs</em> weekly newsletter.
            </p>
          </section>

          {!latestEp && (
            <EmptyArchiveState
              title="No archive data loaded yet."
              detail="The local Worker is running, but the local D1 database does not have any episodes, chunks, or topics yet."
            />
          )}

          {latestEp && (
            <section class="latest-episode-panel body-panel">
              <h2 class="section-heading">
                Latest: <a href={`/episodes/${latestEp.slug}`} class="latest-episode-link">{latestEp.title}</a>
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
                  <h3 class="section-heading">Topics</h3>
                  <TopicStrip topics={latestTopics.slice(0, 10)} />
                </aside>
              )}
            </section>
          )}

          {connected.length > 0 && (
            <section class="most-connected body-panel body-panel-list">
              <h2 class="section-heading">Most Connected</h2>
              <ul>
                {connected.map((r: any) => (
                  <BrowseRow
                    key={r.id}
                    href={`/chunks/${r.slug}`}
                    title={r.title}
                    meta={r.published_date}
                    metaHref={`/episodes/${r.episode_slug}`}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>

        {hasHomeRail && <aside class="page-rail home-margin rail-stack">
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
            <TopicRailList
              title="Popular Topics"
              topics={topics}
              sectionClassName="margin-topics"
              listClassName="topics-list"
              help={(
                <HelpTip
                  label="Explain popular topics"
                  text="Frequently recurring themes across the archive."
                />
              )}
            />
          )}

          {novelTopicHistory.length > 1 && (() => {
            const width = 180;
            const height = 40;
            const pad = 2;
            const maxNovel = Math.max(...novelTopicHistory.map((point) => point.novel_topics), 1);
            const latestPoint = novelTopicHistory[novelTopicHistory.length - 1];
            const peakPoint = novelTopicHistory.reduce((best, point) => {
              if (point.novel_topics > best.novel_topics) return point;
              return best;
            }, novelTopicHistory[0]);
            const sparkPoints = novelTopicHistory.map((point, index) => ({
              x: novelTopicHistory.length === 1
                ? width / 2
                : pad + (index / Math.max(novelTopicHistory.length - 1, 1)) * (width - pad * 2),
              y: height - pad - (point.novel_topics / maxNovel) * (height - pad * 2),
            })).map((point) => `${point.x},${point.y}`).join(" ");

            return (
              <TopicChartPanel
                title="Novel Topic History"
                variant="rail"
                className="home-novel-topic-history"
                help={(
                  <HelpTip
                    label="Explain novel topic history"
                    text="New-to-corpus topics per episode. Higher points mean more topics appeared for the first time in Bobbin in that episode."
                  />
                )}
                chart={(
                  <svg viewBox={`0 0 ${width} ${height}`} class="rail-sparkline" role="img" aria-label="Novel topics per episode">
                    <title>{`Novel topics over the last year. Latest: ${latestPoint.novel_topics}. Peak: ${peakPoint.novel_topics} on ${peakPoint.published_date}.`}</title>
                    <polyline
                      points={sparkPoints}
                      fill="none"
                      stroke="var(--rail-signal-color)"
                      stroke-width="1.5"
                    />
                  </svg>
                )}
                meta={(
                  <p class="section-meta section-meta-row section-meta--after">
                    <span><strong class="section-meta-label">Latest</strong>{latestPoint.novel_topics} new topic{latestPoint.novel_topics === 1 ? "" : "s"}</span>
                    <span><strong class="section-meta-label">Peak</strong>{peakPoint.novel_topics} on {peakPoint.published_date}</span>
                  </p>
                )}
              />
            );
          })()}
        </aside>}
      </div>
    </Layout>
  );
});

export { home as homeRoutes };
