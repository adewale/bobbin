import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { TopicCloud } from "../components/TopicCloud";
import { SearchForm } from "../components/SearchForm";
import { getRecentEpisodes, getChunksByEpisode, getEpisodeTopics } from "../db/episodes";
import { getTopTopics, getThemeRiverData } from "../db/topics";
import { getMostConnected } from "../db/word-stats";

const home = new Hono<AppEnv>();

home.get("/", async (c) => {
  const [episodes, topics, connected, themeRiver] = await Promise.all([
    getRecentEpisodes(c.env.DB, 10),
    getTopTopics(c.env.DB, 30),
    getMostConnected(c.env.DB, 8),
    getThemeRiverData(c.env.DB, 8),
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

      {themeRiver.data.length > 0 && themeRiver.episodes.length > 0 && (() => {
        const data = themeRiver.data;
        const dates = themeRiver.episodes;
        const width = 600;
        const height = 120;
        const pad = 4;
        const w = width - pad * 2;
        const h = height - pad * 2;

        const totals = dates.map((_: string, i: number) => data.reduce((sum: number, d: any) => sum + d.values[i], 0));
        const maxTotal = Math.max(...totals, 1);

        const colors = [
          "var(--accent)", "#d06030", "#a03820", "#c05830",
          "#b04820", "#905020", "#c06840", "#a04030"
        ];

        const paths: { d: string; color: string; name: string; slug: string }[] = [];
        const baseline = new Array(dates.length).fill(0);

        for (let t = 0; t < data.length; t++) {
          const topLine: string[] = [];
          const bottomLine: string[] = [];

          for (let i = 0; i < dates.length; i++) {
            const x = dates.length === 1 ? w / 2 : (i / (dates.length - 1)) * w + pad;
            const yBottom = h + pad - (baseline[i] / maxTotal) * h;
            const yTop = h + pad - ((baseline[i] + data[t].values[i]) / maxTotal) * h;

            topLine.push(`${x},${yTop}`);
            bottomLine.unshift(`${x},${yBottom}`);

            baseline[i] += data[t].values[i];
          }

          paths.push({
            d: `M${topLine.join(" L")} L${bottomLine.join(" L")} Z`,
            color: colors[t % colors.length],
            name: data[t].name,
            slug: data[t].slug,
          });
        }

        return (
          <section class="theme-river">
            <svg viewBox={`0 0 ${width} ${height + 16}`} class="theme-river-svg">
              {paths.map((p, i) => (
                <a key={i} href={`/topics/${p.slug}`}>
                  <path d={p.d} fill={p.color} opacity="0.7" />
                  <title>{p.name}</title>
                </a>
              ))}
              <text x={pad} y={height + 12} fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">{dates[0]}</text>
              <text x={width - pad} y={height + 12} text-anchor="end" fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">{dates[dates.length - 1]}</text>
              {paths.map((p, i) => {
                const midIdx = Math.floor(dates.length / 2);
                const x = dates.length === 1 ? w / 2 : (midIdx / (dates.length - 1)) * w + pad;
                let cumBefore = 0;
                for (let t = 0; t < i; t++) cumBefore += data[t].values[midIdx];
                const yMid = h + pad - ((cumBefore + data[i].values[midIdx] / 2) / maxTotal) * h;
                return data[i].values[midIdx] > 0 ? (
                  <text key={`label-${i}`} x={x} y={yMid} text-anchor="middle" dominant-baseline="central"
                    fill="white" font-size="8" font-family="var(--font-ui)" font-weight="600"
                    pointer-events="none">{p.name}</text>
                ) : null;
              })}
            </svg>
          </section>
        );
      })()}

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
