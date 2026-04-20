import { Hono } from "hono";
import type { AppEnv, EpisodeRow, ChunkRow, TopicRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { RichContent, RichFootnotes, parseFootnotesJson, parseRichContentJson } from "../components/RichContent";
import { monthName } from "../lib/date";
import { getAllEpisodesGrouped, getEpisodeBySlug, getChunksByEpisode, getEpisodeTopicsBlended, getAdjacentEpisodes } from "../db/episodes";
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
    <Layout title="Episodes" description="All Bits and Bobs episodes by date" activePath="/episodes" mainClassName="main-wide">
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

  const [chunksList, blendedTopics, adjacent] = await Promise.all([
    getChunksByEpisode(c.env.DB, episode.id),
    getEpisodeTopicsBlended(c.env.DB, episode.id, 5, 5),
    getAdjacentEpisodes(c.env.DB, episode.published_date),
  ]);

  return c.html(
    <Layout title={episode.title} description={`Bits and Bobs from ${episode.published_date} — ${episode.chunk_count} chunks`} activePath="/episodes" mainClassName="main-wide">
      <Breadcrumbs
        crumbs={[
          { label: "Episodes", href: "/episodes" },
          { label: episode.title },
        ]}
      />
      <div class={(blendedTopics.main.length > 0 || blendedTopics.distinctive.length > 0) ? "page-with-rail episode-detail-layout" : "episode-detail-layout"}>
        <article class="page-body episode-detail">
          <h1>{episode.title}</h1>
          <time datetime={episode.published_date}>{episode.published_date}</time>

          {episode.format === "essays" ? (
            <section class="episode-essays">
              {chunksList.map((chunk) => (
                <article key={chunk.id} class="essay" id={chunk.slug}>
                  <h2><a href={`/chunks/${chunk.slug}`}>{chunk.title}</a></h2>
                  <div class="essay-content">
                    {parseRichContentJson(chunk.rich_content_json).length > 0 ? (
                      <>
                        <RichContent blocks={parseRichContentJson(chunk.rich_content_json)} />
                        <RichFootnotes footnotes={parseFootnotesJson((chunk as any).footnotes_json ?? null)} />
                      </>
                    ) : (
                      chunk.content.split("\n").filter((line, i) => {
                        if (i === 0 && line.trim() === chunk.title.trim()) return false;
                        return true;
                      }).map((line, i) => (
                        line.trim() ? <p key={i}>{line}</p> : null
                      ))
                    )}
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <div class="episode-chunks">
              {chunksList.map((chunk, idx) => {
                const richBlocks = parseRichContentJson(chunk.rich_content_json);
                const bodyLines = chunk.content.split("\n").filter((line, i) => {
                  if (i === 0 && line.trim() === chunk.title.trim()) return false;
                  return line.trim();
                });
                const hasBody = richBlocks.length > 0 || bodyLines.length > 0;

                return hasBody ? (
                  <details key={chunk.id} class="chunk-row">
                    <summary>
                      <a href={`/chunks/${chunk.slug}`} class="chunk-num" onclick="event.stopPropagation()">{idx + 1}</a>
                      <span class="chunk-title">{chunk.title}</span>
                    </summary>
                    <div class="chunk-body">
                      {richBlocks.length > 0 ? (
                        <>
                          <RichContent blocks={richBlocks} />
                          <RichFootnotes footnotes={parseFootnotesJson((chunk as any).footnotes_json ?? null)} />
                        </>
                      ) : bodyLines.map((line, i) => (
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

        {(blendedTopics.main.length > 0 || blendedTopics.distinctive.length > 0) && (
          <aside class="page-rail topics-margin">
            {blendedTopics.main.length > 0 && (
              <div class="topic-tier-main">
                <h3>Topics</h3>
                <div class="topics">
                  {blendedTopics.main.map((topic) => (
                    <a key={topic.id} href={`/topics/${topic.slug}`} class="topic">
                      {topic.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {blendedTopics.distinctive.length > 0 && (
              <div class="distinctive-topics">
                <h4>Distinctive</h4>
                <div class="topics">
                  {blendedTopics.distinctive.map((topic) => (
                    <a key={topic.id} href={`/topics/${topic.slug}`} class="topic topic-distinctive">
                      {topic.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {(adjacent.prev || adjacent.next) && (
        <nav class="episode-nav">
          {adjacent.prev && (
            <a href={`/episodes/${adjacent.prev.slug}`} class="nav-prev">
              &larr; {adjacent.prev.published_date}
            </a>
          )}
          {adjacent.next && (
            <a href={`/episodes/${adjacent.next.slug}`} class="nav-next">
              {adjacent.next.published_date} &rarr;
            </a>
          )}
        </nav>
      )}
    </Layout>
  );
});

export { episodes as episodeRoutes };
