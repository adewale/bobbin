import { Context, Hono } from "hono";
import { BrowseRow, BrowseRowList, BrowseSection, BrowseSubsection } from "../components/BrowseIndex";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EmptyArchiveState } from "../components/EmptyArchiveState";
import { HelpTip } from "../components/HelpTip";
import { Layout } from "../components/Layout";
import { TopicList, type TopicListItem } from "../components/TopicList";
import { getAllEpisodesGrouped } from "../db/episodes";
import {
  getChunksInPeriod,
  getEpisodesInPeriod,
  getMostConnectedInPeriod,
  getPeriodArchiveContrast,
  getPeriodMovers,
  getPeriodNewTopics,
  getPeriodTopicCounts,
} from "../db/periods";
import { monthName } from "../lib/date";
import { collectExternalLinks } from "../lib/episode-rail";
import {
  parsePeriodPath,
  periodBounds,
  periodLabel,
  periodPath,
  previousPeriod,
  type Period,
} from "../lib/period";
import { buildPeriodSummary } from "../lib/period-summary";
import type { AppEnv } from "../types";

const summaries = new Hono<AppEnv>();

const DISPLAY_NEW_TOPICS_LIMIT = 8;
const DISPLAY_MOVERS_LIMIT = 5;

type PeriodIndexMonth = {
  period: Extract<Period, { kind: "month" }>;
  episodeCount: number;
  chunkCount: number;
};

type PeriodIndexYear = {
  period: Extract<Period, { kind: "year" }>;
  episodeCount: number;
  chunkCount: number;
  months: PeriodIndexMonth[];
};

function plural(n: number, singular: string) {
  return `${n} ${singular}${n === 1 ? "" : "s"}`;
}

function countMeta(episodeCount: number, chunkCount: number) {
  return `${plural(episodeCount, "episode")}, ${plural(chunkCount, "chunk")}`;
}

function periodPartsFromDate(isoDate: string) {
  return {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
  };
}

async function buildIndexYears(db: D1Database): Promise<PeriodIndexYear[]> {
  const episodes = await getAllEpisodesGrouped(db);
  const monthsByYear = new Map<number, Set<number>>();

  for (const episode of episodes) {
    const { year, month } = periodPartsFromDate(episode.published_date);
    const months = monthsByYear.get(year) ?? new Set<number>();
    months.add(month);
    monthsByYear.set(year, months);
  }

  return Promise.all(
    [...monthsByYear.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(async ([year, months]) => {
        const yearPeriod = { kind: "year", year } as const;
        const [yearEpisodes, yearChunks, monthRows] = await Promise.all([
          getEpisodesInPeriod(db, periodBounds(yearPeriod)),
          getChunksInPeriod(db, periodBounds(yearPeriod)),
          Promise.all(
            [...months]
              .sort((left, right) => right - left)
              .map(async (month) => {
                const period = { kind: "month", year, month } as const;
                const [monthEpisodes, monthChunks] = await Promise.all([
                  getEpisodesInPeriod(db, periodBounds(period)),
                  getChunksInPeriod(db, periodBounds(period)),
                ]);
                return {
                  period,
                  episodeCount: monthEpisodes.length,
                  chunkCount: monthChunks.length,
                };
              })
          ),
        ]);

        return {
          period: yearPeriod,
          episodeCount: yearEpisodes.length,
          chunkCount: yearChunks.length,
          months: monthRows,
        };
      })
  );
}

function monthlyBreadcrumbs(period: Period) {
  if (period.kind === "year") {
    return [
      { label: "Summaries", href: "/summaries" },
      { label: periodLabel(period) },
    ];
  }

  return [
    { label: "Summaries", href: "/summaries" },
    { label: String(period.year), href: periodPath({ kind: "year", year: period.year }) },
    { label: periodLabel(period) },
  ];
}

function topNewTopic(
  newTopics: Array<{ name: string; slug: string }>,
  topicCounts: Array<{ name: string; slug: string; chunk_count: number }>,
) {
  const newSlugs = new Set(newTopics.map((topic) => topic.slug));
  return topicCounts
    .filter((topic) => newSlugs.has(topic.slug))
    .sort((left, right) => right.chunk_count - left.chunk_count || left.name.localeCompare(right.name))[0];
}

function moversList(
  movers: {
    intensified: Array<{ name: string; slug: string; delta: number }>;
    downshifted: Array<{ name: string; slug: string; delta: number }>;
  } | null,
): TopicListItem[] {
  if (!movers) return [];

  return [
    ...movers.intensified.map((topic) => ({
      name: topic.name,
      slug: topic.slug,
      trend: "up" as const,
      count: topic.delta,
    })),
    ...movers.downshifted.map((topic) => ({
      name: topic.name,
      slug: topic.slug,
      trend: "down" as const,
      count: Math.abs(topic.delta),
    })),
  ];
}

function groupedEpisodes(episodes: Array<{ id: number; slug: string; title: string; published_date: string; chunk_count: number }>) {
  const byMonth = new Map<number, typeof episodes>();
  for (const episode of episodes) {
    const { month } = periodPartsFromDate(episode.published_date);
    const group = byMonth.get(month) ?? [];
    group.push(episode);
    byMonth.set(month, group);
  }
  return [...byMonth.entries()].sort((left, right) => right[0] - left[0]);
}

summaries.get("/", async (c) => {
  const years = await buildIndexYears(c.env.DB);

  return c.html(
    <Layout
      title="Summaries"
      description="Calendar summaries of the Bits and Bobs archive"
      activePath="/summaries"
      mainClassName="main-wide"
    >
      <div class="page-shell browse-layout">
        <div class="page-body page-body-single browse-main">
          <section class="page-preamble hero">
            <p class="page-tagline">Browse the archive by calendar month or year.</p>
          </section>

          {years.length === 0 && (
            <EmptyArchiveState
              title="No summaries are available yet."
              detail="Summary pages appear once the archive has at least one episode with a published date."
            />
          )}

          {years.map((year) => (
            <BrowseSection key={year.period.year} title={year.period.year}>
              <BrowseRowList>
                <BrowseRow
                  href={periodPath(year.period)}
                  title={periodLabel(year.period)}
                  meta={countMeta(year.episodeCount, year.chunkCount)}
                />
                {year.months.map((month) => (
                  <BrowseRow
                    key={`${month.period.year}-${month.period.month}`}
                    href={periodPath(month.period)}
                    title={periodLabel(month.period)}
                    meta={countMeta(month.episodeCount, month.chunkCount)}
                  />
                ))}
              </BrowseRowList>
            </BrowseSection>
          ))}
        </div>
      </div>
    </Layout>
  );
});

async function renderPeriodPage(c: Context<AppEnv>, period: Period) {
  const bounds = periodBounds(period);
  const episodes = await getEpisodesInPeriod(c.env.DB, bounds);
  if (episodes.length === 0) return c.notFound();

  const previous = previousPeriod(period);
  const previousBounds = previous ? periodBounds(previous) : null;

  const [chunks, topicCounts, displayNewTopics, allNewTopics, archiveContrast, connected, previousEpisodes] = await Promise.all([
    getChunksInPeriod(c.env.DB, bounds),
    getPeriodTopicCounts(c.env.DB, bounds),
    getPeriodNewTopics(c.env.DB, bounds, DISPLAY_NEW_TOPICS_LIMIT),
    getPeriodNewTopics(c.env.DB, bounds),
    getPeriodArchiveContrast(c.env.DB, bounds),
    getMostConnectedInPeriod(c.env.DB, bounds),
    previousBounds ? getEpisodesInPeriod(c.env.DB, previousBounds) : Promise.resolve([]),
  ]);

  const [displayMovers, allMovers] = previousBounds && previousEpisodes.length > 0
    ? await Promise.all([
      getPeriodMovers(c.env.DB, bounds, previousBounds, DISPLAY_MOVERS_LIMIT),
      getPeriodMovers(c.env.DB, bounds, previousBounds),
    ])
    : [null, null];

  const moverTopics = moversList(displayMovers);
  const links = collectExternalLinks(chunks);
  const topTopic = topicCounts[0];
  const topNew = topNewTopic(allNewTopics, topicCounts);
  const summaryLines = buildPeriodSummary({
    periodLabel: periodLabel(period),
    episodeCount: episodes.length,
    chunkCount: chunks.length,
    firstPublishedDate: episodes[0]?.published_date,
    lastPublishedDate: episodes[episodes.length - 1]?.published_date,
    topByMentions: topTopic ? { name: topTopic.name, chunkCount: topTopic.chunk_count } : undefined,
    newTopicCount: allNewTopics.length,
    topNewTopic: topNew ? { name: topNew.name, chunkCount: topNew.chunk_count } : undefined,
    intensifiedCount: allMovers?.intensified.length ?? 0,
    downshiftedCount: allMovers?.downshifted.length ?? 0,
    topContrast: archiveContrast[0]
      ? { name: archiveContrast[0].name, spikeRatio: archiveContrast[0].spikeRatio }
      : undefined,
  });

  const hasRail = displayNewTopics.length > 0 || moverTopics.length > 0 || archiveContrast.length > 0 || links.length > 0;
  const layoutClass = hasRail ? "page-with-rail page-with-rail--aligned" : "page-shell";
  const bodyClass = hasRail ? "page-body" : "page-body page-body-single";
  const orderedEpisodes = [...episodes].sort((left, right) => right.published_date.localeCompare(left.published_date));

  return c.html(
    <Layout
      title={periodLabel(period)}
      description={`${periodLabel(period)}: ${countMeta(episodes.length, chunks.length)}`}
      activePath="/summaries"
      canonicalUrl={periodPath(period)}
      mainClassName="main-wide"
    >
      <div class={layoutClass}>
        <article class={bodyClass}>
          <div class="page-preamble">
            <Breadcrumbs crumbs={monthlyBreadcrumbs(period)} />
          </div>

          <h1>{periodLabel(period)}</h1>
          <p class="section-meta section-meta-row section-meta--after">
            <span><strong class="section-meta-label">Episodes</strong>{episodes.length}</span>
            <span><strong class="section-meta-label">Chunks</strong>{chunks.length}</span>
          </p>

          {summaryLines.length > 0 && (
            <section class="topic-summary body-panel" aria-labelledby="period-summary-heading">
              <div class="section-heading-row">
                <h2 class="section-heading" id="period-summary-heading">Summary</h2>
                <HelpTip
                  label="Explain period summary"
                  text="A short deterministic readout of the period's span, leading topics, changes, and contrast against the archive."
                />
              </div>
              <ul class="topic-summary-list">
                {summaryLines.map((line, index) => (
                  <li key={`${periodPath(period)}-summary-${index}`}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          {connected.length > 0 && (
            <section class="body-panel body-panel-list">
              <h2 class="section-heading">Representative Chunks</h2>
              <BrowseRowList>
                {connected.map((chunk) => (
                  <BrowseRow
                    key={chunk.id}
                    href={`/chunks/${chunk.slug}`}
                    title={chunk.title}
                    meta={chunk.published_date}
                    metaHref={`/episodes/${chunk.episode_slug}`}
                  />
                ))}
              </BrowseRowList>
            </section>
          )}

          <section class="body-panel">
            <h2 class="section-heading">Episode Timeline</h2>
            {period.kind === "year" ? (
              groupedEpisodes(orderedEpisodes).map(([month, monthEpisodes]) => (
                <BrowseSubsection key={month} title={monthName(month)}>
                  <BrowseRowList>
                    {monthEpisodes.map((episode) => (
                      <BrowseRow
                        key={episode.id}
                        href={`/episodes/${episode.slug}`}
                        title={episode.title}
                        meta={plural(episode.chunk_count, "chunk")}
                      />
                    ))}
                  </BrowseRowList>
                </BrowseSubsection>
              ))
            ) : (
              <BrowseRowList>
                {orderedEpisodes.map((episode) => (
                  <BrowseRow
                    key={episode.id}
                    href={`/episodes/${episode.slug}`}
                    title={episode.title}
                    meta={plural(episode.chunk_count, "chunk")}
                  />
                ))}
              </BrowseRowList>
            )}
          </section>
        </article>

        {hasRail && (
          <aside class="page-rail rail-stack">
            {displayNewTopics.length > 0 && (
              <section class="rail-panel rail-panel-list">
                <div class="rail-panel-heading-row">
                  <h3>New Topics</h3>
                  <HelpTip
                    label="Explain new topics"
                    text="Topics whose first appearance in the archive falls inside this period."
                  />
                </div>
                <TopicList topics={displayNewTopics} layout="stack" />
              </section>
            )}

            {moverTopics.length > 0 && (
              <section class="rail-panel rail-panel-list">
                <div class="rail-panel-heading-row">
                  <h3>Movers</h3>
                  <HelpTip
                    label="Explain movers"
                    text="Salience-weighted changes versus the previous comparable period. Up and down are shown by glyph, not color."
                  />
                </div>
                <TopicList topics={moverTopics} layout="stack" />
              </section>
            )}

            {archiveContrast.length > 0 && (
              <section class="rail-panel rail-panel-list">
                <div class="rail-panel-heading-row">
                  <h3>Archive Contrast</h3>
                  <HelpTip
                    label="Explain archive contrast"
                    text="Topics over-indexed in this period compared with Bobbin overall."
                  />
                </div>
                <TopicList
                  topics={archiveContrast.map((topic) => ({
                    name: topic.name,
                    slug: topic.slug,
                    count: `${topic.spikeRatio.toFixed(1)}× typical`,
                  }))}
                  layout="stack"
                />
              </section>
            )}

            {links.length > 0 && (
              <section class="episode-insight-panel rail-panel">
                <div class="rail-panel-heading-row">
                  <h3>External Links</h3>
                  <HelpTip
                    label="Explain external links"
                    text="Deduplicated external URLs mentioned inside this period, with links back to the chunk that cited them."
                  />
                </div>
                <ul class="episode-insight-list">
                  {links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
                      <span class="insight-meta">
                        via <a href={`/chunks/${link.chunkSlug}`}>{link.chunkTitle}</a>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>
    </Layout>
  );
}

summaries.get("/:year/:month_number", async (c) => {
  const period = parsePeriodPath(c.req.param("year"), c.req.param("month_number"));
  if (!period || period.kind !== "month") return c.notFound();
  return renderPeriodPage(c, period);
});

summaries.get("/:year", async (c) => {
  const period = parsePeriodPath(c.req.param("year"));
  if (!period || period.kind !== "year") return c.notFound();
  return renderPeriodPage(c, period);
});

export { summaries as summaryRoutes };
