import { Hono } from "hono";
import type { AppEnv, EpisodeRow, ChunkRow, TagRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { monthName } from "../lib/date";

const episodes = new Hono<AppEnv>();

// Unified browse: timeline + episode list in one page
episodes.get("/", async (c) => {
  const allEpisodes = await c.env.DB.prepare(
    "SELECT * FROM episodes ORDER BY published_date DESC"
  ).all();

  // Group by year → month
  const byYear = new Map<number, Map<number, any[]>>();
  for (const ep of allEpisodes.results as unknown as EpisodeRow[]) {
    if (!byYear.has(ep.year)) byYear.set(ep.year, new Map());
    const yearMap = byYear.get(ep.year)!;
    if (!yearMap.has(ep.month)) yearMap.set(ep.month, []);
    yearMap.get(ep.month)!.push(ep);
  }

  const years = [...byYear.keys()].sort((a, b) => b - a);

  return c.html(
    <Layout title="Browse" description="Browse all Bits and Bobs episodes by date">
      <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Browse" }]} />
      <h1>Browse</h1>
      <p>{allEpisodes.results.length} episodes</p>

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
  const episode = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE slug = ?"
  )
    .bind(slug)
    .first<EpisodeRow>();

  if (!episode) return c.notFound();

  const chunks = await c.env.DB.prepare(
    "SELECT * FROM chunks WHERE episode_id = ? ORDER BY position"
  )
    .bind(episode.id)
    .all();

  const tags = await c.env.DB.prepare(
    `SELECT t.* FROM tags t
     JOIN episode_tags et ON t.id = et.tag_id
     WHERE et.episode_id = ?
     ORDER BY t.usage_count DESC`
  )
    .bind(episode.id)
    .all();

  return c.html(
    <Layout title={episode.title} description={`Bits and Bobs from ${episode.published_date} — ${episode.chunk_count} observations`}>
      <Breadcrumbs
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Episodes", href: "/episodes" },
          { label: episode.title },
        ]}
      />
      <article class="episode-detail">
        <h1>{episode.title}</h1>
        <time datetime={episode.published_date}>
          {new Date(episode.published_date + "T00:00:00Z").toLocaleDateString(
            "en-US",
            { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
          )}
        </time>
        {(tags.results as unknown as TagRow[]).length > 0 && (
          <aside class="tags-margin">
            <details>
              <summary>Tags</summary>
              <div class="tags">
                {(tags.results as unknown as TagRow[]).map((tag) => (
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
            {(chunks.results as unknown as ChunkRow[]).map((chunk) => (
              <article key={chunk.id} class="essay" id={chunk.slug}>
                <h2><a href={`/chunks/${chunk.slug}`}>{chunk.title}</a></h2>
                <div class="essay-content">
                  {chunk.content.split("\n").map((line, i) => (
                    line.trim() ? <p key={i}>{line}</p> : null
                  ))}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <ol class="episode-toc">
            {(chunks.results as unknown as ChunkRow[]).map((chunk) => (
              <li key={chunk.id}>
                <a href={`/chunks/${chunk.slug}`}>{chunk.title}</a>
              </li>
            ))}
          </ol>
        )}
      </article>
    </Layout>
  );
});

export { episodes as episodeRoutes };
