import { Hono } from "hono";
import type { AppEnv, EpisodeRow, ChunkRow, TagRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { monthName } from "../lib/date";
import { getAllEpisodesGrouped, getEpisodeBySlug, getChunksByEpisode, getEpisodeTags } from "../db/episodes";

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
                          {ep.chunk_count} observations
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

  const [chunksList, tagsList] = await Promise.all([
    getChunksByEpisode(c.env.DB, episode.id),
    getEpisodeTags(c.env.DB, episode.id),
  ]);

  return c.html(
    <Layout title={episode.title} description={`Bits and Bobs from ${episode.published_date} — ${episode.chunk_count} observations`} activePath="/episodes">
      <Breadcrumbs
        crumbs={[
          { label: "Episodes", href: "/episodes" },
          { label: episode.title },
        ]}
      />
      <article class="episode-detail">
        <h1>{episode.title}</h1>
        <time datetime={episode.published_date}>{episode.published_date}</time>
        {tagsList.length > 0 && (
          <aside class="tags-margin">
            <details>
              <summary>Tags</summary>
              <div class="tags">
                {tagsList.map((tag) => (
                  <a key={tag.id} href={`/tags/${tag.slug}`} class="tag">
                    {tag.name}
                  </a>
                ))}
              </div>
            </details>
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
          <div class="episode-notes">
            {chunksList.map((chunk, idx) => (
              <details key={chunk.id} class="observation">
                <summary>
                  <span class="obs-num">{idx + 1}</span>
                  <span class="obs-title">{chunk.title}</span>
                </summary>
                <div class="obs-content">
                  {chunk.content.split("\n").filter((line, i) => {
                    if (i === 0 && line.trim() === chunk.title.trim()) return false;
                    return true;
                  }).map((line, i) => (
                    line.trim() ? <p key={i}>{line}</p> : null
                  ))}
                  <a href={`/chunks/${chunk.slug}`} class="obs-permalink">Permalink &rarr;</a>
                </div>
              </details>
            ))}
          </div>
        )}
      </article>
    </Layout>
  );
});

export { episodes as episodeRoutes };
