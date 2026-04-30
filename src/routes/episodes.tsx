import { Hono } from "hono";
import type { AppEnv, EpisodeRow, ChunkRow, TopicRow } from "../types";
import { BrowseRow, BrowseRowList, BrowseSection, BrowseSubsection } from "../components/BrowseIndex";
import { EmptyArchiveState } from "../components/EmptyArchiveState";
import { HelpTip } from "../components/HelpTip";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { RichContent, RichFootnotes, parseFootnotesJson, parseRichContentJson } from "../components/RichContent";
import { TopicList } from "../components/TopicList";
import { monthName } from "../lib/date";
import { collectExternalLinks } from "../lib/episode-rail";
import { getAdjacentEpisodes, getAllEpisodesGrouped, getChunksByEpisode, getEpisodeBySlug, getEpisodeRailInsights, getEpisodeTopicsBlended } from "../db/episodes";

const episodes = new Hono<AppEnv>();

function normalizeLeadingContent(text: string): string {
  return text
    .replace(/\[(?:[a-z]{1,4}|\d+)\]/gi, "")
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function trimLeadingTitleLine(lines: string[], title: string): string[] {
  if (lines.length === 0) return lines;
  return normalizeLeadingContent(lines[0] || "") === normalizeLeadingContent(title)
    ? lines.slice(1)
    : lines;
}

function trimLeadingTitleBlock(blocks: ReturnType<typeof parseRichContentJson>, title: string) {
  if (blocks.length === 0) return blocks;
  const [first, ...rest] = blocks;
  if (!first) return blocks;
  return normalizeLeadingContent(first.plainText || "") === normalizeLeadingContent(title)
    ? rest
    : blocks;
}

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
  const latestEpisode = allEpisodesList[0] || null;
  const earliestEpisode = allEpisodesList[allEpisodesList.length - 1] || null;
  const episodeTagline = latestEpisode && earliestEpisode
    ? `${allEpisodesList.length} episodes from ${earliestEpisode.published_date} to ${latestEpisode.published_date}`
    : `${allEpisodesList.length} episodes`;

    return c.html(
      <Layout title="Episodes" description="All Bits and Bobs episodes by date" activePath="/episodes" mainClassName="main-wide">
      <div class="page-with-rail page-with-rail--aligned browse-layout">
        <div class="page-body browse-main">
          <section class="page-preamble hero">
            <p class="page-tagline">{episodeTagline}</p>
          </section>

          {allEpisodesList.length === 0 && (
            <EmptyArchiveState
              title="No episodes are available yet."
              detail="The schema is present, but the local archive has not been populated with episode data yet."
            />
          )}

          {years.map((year) => {
            const months = [...byYear.get(year)!.keys()].sort((a, b) => b - a);
            return (
              <BrowseSection key={year} id={`year-${year}`} title={year}>
                {months.map((month) => {
                  const eps = byYear.get(year)!.get(month)!;
                  return (
                    <BrowseSubsection key={month} title={monthName(month)}>
                      <BrowseRowList>
                        {eps.map((ep: any) => (
                          <BrowseRow
                            key={ep.id}
                            href={`/episodes/${ep.slug}`}
                            title={ep.title}
                            meta={
                              <>
                                {ep.chunk_count} chunk{ep.chunk_count !== 1 ? "s" : ""}
                                {ep.format === "essays" && (
                                  <span class="format-badge essay">essay</span>
                                )}
                              </>
                            }
                          />
                        ))}
                      </BrowseRowList>
                    </BrowseSubsection>
                  );
                })}
              </BrowseSection>
            );
          })}
        </div>

        {years.length > 0 && <aside class="page-rail browse-rail rail-stack">
          <nav class="page-toc rail-panel" aria-label="Years">
            <div class="rail-panel-heading-row">
              <h3>Years</h3>
              <HelpTip
                label="Explain years navigation"
                text="Jump through the archive by publication year."
              />
            </div>
            <ol>
              {years.map((year, index) => (
                <li key={year}><a href={`#year-${year}`} {...(index === 0 ? { "aria-current": "true" } : {})}>{year}</a></li>
              ))}
            </ol>
          </nav>
        </aside>}
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
              {chunksList.map((chunk) => {
                const richBlocks = trimLeadingTitleBlock(parseRichContentJson(chunk.rich_content_json), chunk.title);
                const bodyLines = trimLeadingTitleLine(chunk.content.split("\n").filter((line) => line.trim()), chunk.title);

                return (
                  <article key={chunk.id} class="essay" id={chunk.slug}>
                    <h2><a href={`/chunks/${chunk.slug}`}>{chunk.title}</a></h2>
                    <div class="essay-content">
                      {richBlocks.length > 0 ? (
                        <>
                          <RichContent blocks={richBlocks} />
                          <RichFootnotes footnotes={parseFootnotesJson((chunk as any).footnotes_json ?? null)} />
                        </>
                      ) : (
                        bodyLines.map((line, i) => (
                          line.trim() ? <p key={i}>{line}</p> : null
                        ))
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          ) : (
            <div class="episode-chunks">
              {chunksList.map((chunk, idx) => {
                const richBlocks = trimLeadingTitleBlock(parseRichContentJson(chunk.rich_content_json), chunk.title);
                const bodyLines = trimLeadingTitleLine(chunk.content.split("\n").filter((line) => line.trim()), chunk.title);
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
              <section class="topic-tier-main rail-panel rail-panel-list">
                <div class="rail-panel-heading-row">
                  <h3>Topics</h3>
                  <HelpTip
                    label="Explain episode topics"
                    text="The main themes that recur across this episode."
                  />
                </div>
                <TopicList topics={blendedTopics.main} layout="stack" />
              </section>
            )}
            {blendedTopics.distinctive.length > 0 && (
              <section class="distinctive-topics rail-panel rail-panel-list">
                <div class="rail-panel-heading-row">
                  <h3>Distinctive</h3>
                  <HelpTip
                    label="Explain distinctive topics"
                    text="Topics that are unusually salient in this episode compared with ordinary language and the rest of the archive."
                  />
                </div>
                <TopicList topics={blendedTopics.distinctive} layout="stack" />
              </section>
            )}

            {railInsights.unexpectedPairings.length > 0 && (
              <section class="episode-insight-panel rail-panel">
                <div class="rail-panel-heading-row">
                  <h4>Unexpected Pairings</h4>
                  <HelpTip
                    label="Explain unexpected pairings"
                    text="Topic pairs that recur together in this episode more than you would expect from the archive."
                  />
                </div>
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
                <div class="rail-panel-heading-row">
                  <h4>Most Novel Chunks</h4>
                  <HelpTip
                    label="Explain most novel chunks"
                    text="Specific chunks that feel least like the existing archive. Use this as a jump list for the freshest material."
                  />
                </div>
                <ul class="episode-insight-list">
                  {railInsights.mostNovelChunks.map((chunk) => (
                    <li key={chunk.slug}>
                      <a href={`/chunks/${chunk.slug}`}>{chunk.title}</a>
                      {chunk.topics.length > 0 && (
                        <span class="insight-meta">
                          via{" "}
                          <TopicList topics={chunk.topics.slice(0, 2)} layout="run" />
                        </span>
                      )}
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
                <div class="rail-panel-heading-row">
                  <h4>Since Last Episode</h4>
                  <HelpTip
                    label="Explain since last episode"
                    text="Changes compared with the previous episode. Up and Down are salience-weighted deltas; New means new to the corpus, not just new this week."
                  />
                </div>
                <p class="episode-insight-context">Compared with <a href={`/episodes/${railInsights.sinceLast.previousEpisode.slug}`}>{railInsights.sinceLast.previousEpisode.title}</a>.</p>
                <ul class="episode-insight-list">
                  {railInsights.sinceLast.intensified.length > 0 && (
                    <li>
                      <span class="rail-item-title">Up</span>
                      <TopicList
                        layout="run"
                        topics={railInsights.sinceLast.intensified.map((topic) => ({
                          name: topic.name,
                          slug: topic.slug,
                          trend: "up" as const,
                          count: topic.delta,
                        }))}
                      />
                    </li>
                  )}
                  {railInsights.sinceLast.downshifted.length > 0 && (
                    <li>
                      <span class="rail-item-title">Down</span>
                      <TopicList
                        layout="run"
                        topics={railInsights.sinceLast.downshifted.map((topic) => ({
                          name: topic.name,
                          slug: topic.slug,
                          trend: "down" as const,
                          count: Math.abs(topic.delta),
                        }))}
                      />
                    </li>
                  )}
                  {railInsights.sinceLast.newTopics.length > 0 && (
                    <li>
                      <span class="rail-item-title">New</span>
                      <TopicList layout="run" topics={railInsights.sinceLast.newTopics} />
                    </li>
                  )}
                </ul>
              </section>
            )}

            {railInsights.archiveContrast.length > 0 && (
              <section class="episode-insight-panel rail-panel rail-panel-list">
                <div class="rail-panel-heading-row">
                  <h4>Archive Contrast</h4>
                  <HelpTip
                    label="Explain archive contrast"
                    text="Topic-level over-indexing relative to Bobbin overall. This explains what the episode is unusually about, not which chunk is newest."
                  />
                </div>
                <TopicList
                  layout="stack"
                  topics={railInsights.archiveContrast.map((topic) => ({
                    name: topic.name,
                    slug: topic.slug,
                    count: `${topic.spikeRatio.toFixed(1)}× typical`,
                  }))}
                />
              </section>
            )}

            {externalLinks.length > 0 && (
              <section class="episode-insight-panel rail-panel">
                <div class="rail-panel-heading-row">
                  <h4>External Links</h4>
                  <HelpTip
                    label="Explain external links"
                    text="Deduplicated external URLs referenced in this episode, with links back to the chunk that mentioned them."
                  />
                </div>
                <ul class="episode-insight-list">
                  {externalLinks.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
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
