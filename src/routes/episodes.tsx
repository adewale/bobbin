import { Hono } from "hono";
import type { AppEnv, EpisodeRow, ChunkRow, TopicRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { RichContent, RichFootnotes, parseFootnotesJson, parseRichContentJson } from "../components/RichContent";
import { monthName } from "../lib/date";
import { collectExternalLinks } from "../lib/episode-rail";
import { getAdjacentEpisodes, getAllEpisodesGrouped, getChunksByEpisode, getEpisodeBySlug, getEpisodeRailInsights, getEpisodeTopicsBlended } from "../db/episodes";

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
      <div class="page-with-rail page-with-rail--aligned browse-layout">
        <div class="page-body browse-main">
          <div class="page-preamble">
            <p class="page-count">{allEpisodesList.length} episodes</p>
          </div>

          {years.map((year) => {
            const months = [...byYear.get(year)!.keys()].sort((a, b) => b - a);
            return (
              <section key={year} class="browse-year" id={`year-${year}`}>
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
        </div>

        <aside class="page-rail browse-rail">
          <nav class="page-toc" aria-label="Years">
            <h3>Years</h3>
            <ol>
              {years.map((year) => (
                <li key={year}><a href={`#year-${year}`}>{year}</a></li>
              ))}
            </ol>
          </nav>
        </aside>
      </div>
    </Layout>
  );
});

episodes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const episode = await getEpisodeBySlug(c.env.DB, slug);
  if (!episode) return c.notFound();

  const [chunksList, blendedTopics, adjacent, railInsights] = await Promise.all([
    getChunksByEpisode(c.env.DB, episode.id),
    getEpisodeTopicsBlended(c.env.DB, episode.id, 5, 5),
    getAdjacentEpisodes(c.env.DB, episode.published_date),
    getEpisodeRailInsights(c.env.DB, episode.id, episode.published_date),
  ]);
  const externalLinks = collectExternalLinks(chunksList);
  const hasEpisodeRail = blendedTopics.main.length > 0
    || blendedTopics.distinctive.length > 0
    || railInsights.unexpectedPairings.length > 0
    || railInsights.mostNovelChunks.length > 0
    || railInsights.archiveContrast.length > 0
    || externalLinks.length > 0
    || (railInsights.sinceLast.previousEpisode !== null && (
      railInsights.sinceLast.intensified.length > 0
      || railInsights.sinceLast.downshifted.length > 0
      || railInsights.sinceLast.newTopics.length > 0
    ));

  return c.html(
    <Layout title={episode.title} description={`Bits and Bobs from ${episode.published_date} — ${episode.chunk_count} chunks`} activePath="/episodes" mainClassName="main-wide">
      <div class={hasEpisodeRail ? "page-with-rail page-with-rail--aligned episode-detail-layout" : "episode-detail-layout"}>
        <article class="page-body episode-detail">
          <div class="page-preamble">
            <Breadcrumbs
              crumbs={[
                { label: "Episodes", href: "/episodes" },
                { label: episode.title },
              ]}
            />
          </div>

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
                  <details key={chunk.id} class="chunk-row" id={chunk.slug}>
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
                  <div key={chunk.id} class="chunk-row chunk-row-single" id={chunk.slug}>
                    <a href={`/chunks/${chunk.slug}`} class="chunk-num">{idx + 1}</a>
                    <span class="chunk-title">{chunk.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        {hasEpisodeRail && (
          <aside class="page-rail topics-margin rail-stack episode-analysis-rail">
            {blendedTopics.main.length > 0 && (
              <section class="topic-tier-main rail-panel">
                <h3>Topics</h3>
                <div class="topics">
                  {blendedTopics.main.map((topic) => (
                    <a key={topic.id} href={`/topics/${topic.slug}`} class="topic">
                      {topic.name}
                    </a>
                  ))}
                </div>
              </section>
            )}
            {blendedTopics.distinctive.length > 0 && (
              <section class="distinctive-topics rail-panel">
                <h3>Distinctive</h3>
                <div class="topics">
                  {blendedTopics.distinctive.map((topic) => (
                    <a key={topic.id} href={`/topics/${topic.slug}`} class="topic topic-distinctive">
                      {topic.name}
                    </a>
                  ))}
                </div>
              </section>
            )}

            {railInsights.unexpectedPairings.length > 0 && (
              <section class="episode-insight-panel rail-panel">
                <h4>Unexpected Pairings</h4>
                <ul class="episode-insight-list">
                  {railInsights.unexpectedPairings.map((pairing) => (
                    <li key={`${pairing.leftSlug}-${pairing.rightSlug}`}>
                      <span>
                        <a href={`/topics/${pairing.leftSlug}`}>{pairing.leftName}</a>
                        {" + "}
                        <a href={`/topics/${pairing.rightSlug}`}>{pairing.rightName}</a>
                      </span>
                      <span class="insight-meta">{pairing.corpusCount === 0 ? "No earlier chunk overlap" : `${pairing.corpusCount} earlier shared chunk${pairing.corpusCount === 1 ? "" : "s"}`}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {railInsights.mostNovelChunks.length > 0 && (
              <section class="episode-insight-panel rail-panel">
                <h4>Most Novel Chunks</h4>
                <p class="episode-insight-kicker">Specific chunks that feel least like the existing archive. Start here for the freshest material.</p>
                <ul class="episode-insight-list">
                  {railInsights.mostNovelChunks.map((chunk) => (
                    <li key={chunk.slug}>
                      <a href={`/chunks/${chunk.slug}`}>{chunk.title}</a>
                      {chunk.topicNames.length > 0 && <span class="insight-meta">via {chunk.topicNames.slice(0, 2).join(" + ")}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {railInsights.sinceLast.previousEpisode && (
              railInsights.sinceLast.intensified.length > 0
              || railInsights.sinceLast.downshifted.length > 0
              || railInsights.sinceLast.newTopics.length > 0
            ) && (
              <section class="episode-insight-panel rail-panel">
                <h4>Since Last Episode</h4>
                <p class="episode-insight-kicker">Compared with <a href={`/episodes/${railInsights.sinceLast.previousEpisode.slug}`}>{railInsights.sinceLast.previousEpisode.title}</a>. Ranked by salience-weighted change, not just raw counts.</p>
                <ul class="episode-insight-list episode-insight-list-compact">
                  {railInsights.sinceLast.intensified.length > 0 && (
                    <li>
                      <span class="insight-label">Up</span>
                      <span>{railInsights.sinceLast.intensified.map((topic) => `${topic.name} (+${topic.delta})`).join(", ")}</span>
                    </li>
                  )}
                  {railInsights.sinceLast.downshifted.length > 0 && (
                    <li>
                      <span class="insight-label">Down</span>
                      <span>{railInsights.sinceLast.downshifted.map((topic) => `${topic.name} (${topic.delta})`).join(", ")}</span>
                    </li>
                  )}
                  {railInsights.sinceLast.newTopics.length > 0 && (
                    <li>
                      <span class="insight-label">New</span>
                      <span>{railInsights.sinceLast.newTopics.map((topic) => topic.name).join(", ")}</span>
                    </li>
                  )}
                </ul>
              </section>
            )}

            {railInsights.archiveContrast.length > 0 && (
              <section class="episode-insight-panel rail-panel">
                <h4>Archive Contrast</h4>
                <p class="episode-insight-kicker">Topic-level over-indexing relative to Bobbin overall, not chunk-level novelty.</p>
                <ul class="episode-insight-list">
                  {railInsights.archiveContrast.map((topic) => (
                    <li key={topic.slug}>
                      <a href={`/topics/${topic.slug}`}>{topic.name}</a>
                      <span class="insight-meta">{topic.spikeRatio.toFixed(1)}x typical rate</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {externalLinks.length > 0 && (
              <section class="episode-insight-panel rail-panel">
                <h4>External Links</h4>
                <ul class="episode-insight-list">
                  {externalLinks.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
                      <span class="insight-meta">from <a href={`#${link.chunkSlug}`}>{link.chunkTitle}</a></span>
                    </li>
                  ))}
                </ul>
              </section>
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
