import { Hono } from "hono";
import type { AppEnv, EpisodeRow, ChunkRow, TopicRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { monthName } from "../lib/date";
import { getAllEpisodesGrouped, getEpisodeBySlug, getChunksByEpisode, getEpisodeTopics } from "../db/episodes";
import { getTrendingTopicsForEpisode } from "../db/topics";

const episodes = new Hono<AppEnv>();

// Unified browse: timeline + episode list in one page
episodes.get("/", async (c) => {
  const allEpisodesList = await getAllEpisodesGrouped(c.env.DB);

  // Group by year → month
  const byYear = new Map<number, Map<number, any[]>>();
  for (const ep of allEpisodesList) {
    if (!byYear.has(ep.year)) byYear.set(ep.year, new Map());
    const yearMap = byYear.get(ep.year)!;
    if (!yearMap.has(ep.month)) yearMap.set(ep.month, []);
    yearMap.get(ep.month)!.push(ep);
  }

  const years = [...byYear.keys()].sort((a, b) => b - a);

  return c.html(
    <Layout title="Episodes" description="All Bits and Bobs episodes by date" activePath="/episodes">
      <p class="page-count">{allEpisodesList.length} episodes</p>

      {years.map((year) => {
        const months = [...byYear.get(year)!.keys()].sort((a, b) => b - a);
        return (
          <section key={year} class="browse-year">
            <h2>{year}</h2>
            {months.map((month) => {
              const eps = byYear.get(year)!.get(month)!;
              return (
                <div key={month} class="browse-month">
                  <h3>{monthName(month)}</h3>
                  <ul class="browse-episodes">
                    {eps.map((ep: any) => (
                      <li key={ep.id}>
                        <a href={`/episodes/${ep.slug}`}>{ep.title}</a>
                        <span class="meta">
                          {ep.chunk_count} chunk{ep.chunk_count !== 1 ? "s" : ""}
                          {ep.format === "essays" && (
                            <span class="format-badge essay">essay</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </Layout>
  );
});

episodes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const episode = await getEpisodeBySlug(c.env.DB, slug);
  if (!episode) return c.notFound();

  const [chunksList, topicsList, trending] = await Promise.all([
    getChunksByEpisode(c.env.DB, episode.id),
    getEpisodeTopics(c.env.DB, episode.id),
    getTrendingTopicsForEpisode(c.env.DB, episode.id),
  ]);

  return c.html(
    <Layout title={episode.title} description={`Bits and Bobs from ${episode.published_date} — ${episode.chunk_count} chunks`} activePath="/episodes">
      <Breadcrumbs
        crumbs={[
          { label: "Episodes", href: "/episodes" },
          { label: episode.title },
        ]}
      />
      <article class="episode-detail">
        <h1>{episode.title}</h1>
        <time datetime={episode.published_date}>{episode.published_date}</time>
        {topicsList.length > 0 && (
          <aside class="topics-margin">
            <h3>Topics</h3>
            <div class="topics">
              {topicsList.map((topic) => (
                <a key={topic.id} href={`/topics/${topic.slug}`} class="topic">
                  {topic.name}
                </a>
              ))}
            </div>
            {trending.length > 0 && (
              <div class="trending-topics">
                <h4>Trending &#x2191;</h4>
                {trending.map((t) => (
                  <a key={t.slug} href={`/topics/${t.slug}`} class="trending-item">
                    {t.name} <span class="trending-ratio">(+{t.spikeRatio.toFixed(1)}&times;)</span>
                  </a>
                ))}
              </div>
            )}
          </aside>
        )}

        {episode.format === "essays" ? (
          <section class="episode-essays">
            {chunksList.map((chunk) => (
              <article key={chunk.id} class="essay" id={chunk.slug}>
                <h2><a href={`/chunks/${chunk.slug}`}>{chunk.title}</a></h2>
                <div class="essay-content">
                  {chunk.content.split("\n").filter((line, i) => {
                    if (i === 0 && line.trim() === chunk.title.trim()) return false;
                    return true;
                  }).map((line, i) => (
                    line.trim() ? <p key={i}>{line}</p> : null
                  ))}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <div class="episode-chunks">
            {chunksList.map((chunk, idx) => {
              const bodyLines = chunk.content.split("\n").filter((line, i) => {
                if (i === 0 && line.trim() === chunk.title.trim()) return false;
                return line.trim();
              });
              const hasBody = bodyLines.length > 0;

              return hasBody ? (
                <details key={chunk.id} class="chunk-row">
                  <summary>
                    <a href={`/chunks/${chunk.slug}`} class="chunk-num" onclick="event.stopPropagation()">{idx + 1}</a>
                    <span class="chunk-title">{chunk.title}</span>
                  </summary>
                  <div class="chunk-body">
                    {bodyLines.map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </details>
              ) : (
                <div key={chunk.id} class="chunk-row chunk-row-single">
                  <a href={`/chunks/${chunk.slug}`} class="chunk-num">{idx + 1}</a>
                  <span class="chunk-title">{chunk.title}</span>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </Layout>
  );
});

export { episodes as episodeRoutes };
