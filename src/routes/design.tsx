import { Hono } from "hono";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { BrowseRow, BrowseRowList, BrowseSection, BrowseSubsection } from "../components/BrowseIndex";
import { ChunkCard } from "../components/ChunkCard";
import { EpisodeCard } from "../components/EpisodeCard";
import { Layout } from "../components/Layout";
import { Pagination } from "../components/Pagination";
import { RichContent, RichFootnotes, parseFootnotesJson, parseRichContentJson } from "../components/RichContent";
import { SearchForm } from "../components/SearchForm";
import { TopicCloud } from "../components/TopicCloud";
import { getRecentEpisodes } from "../db/episodes";
import { getTopTopics } from "../db/topics";
import { getMostConnected } from "../db/word-stats";
import type { AppEnv, ChunkRow, EpisodeRow } from "../types";

const design = new Hono<AppEnv>();

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type DesignChunkExample = ChunkRow & {
  episode_slug: string;
  episode_title: string;
  published_date: string;
};

type EpisodeBrowseGroup = {
  year: number;
  months: Array<{
    month: number;
    label: string;
    episodes: EpisodeRow[];
  }>;
};

function groupEpisodesByYearMonth(episodes: EpisodeRow[]): EpisodeBrowseGroup[] {
  const groups: EpisodeBrowseGroup[] = [];
  const byYear = new Map<number, EpisodeBrowseGroup>();

  for (const episode of episodes) {
    let yearGroup = byYear.get(episode.year);
    if (!yearGroup) {
      yearGroup = { year: episode.year, months: [] };
      byYear.set(episode.year, yearGroup);
      groups.push(yearGroup);
    }

    let monthGroup = yearGroup.months.find((month) => month.month === episode.month);
    if (!monthGroup) {
      monthGroup = {
        month: episode.month,
        label: MONTH_NAMES[Math.max(0, Math.min(MONTH_NAMES.length - 1, episode.month - 1))],
        episodes: [],
      };
      yearGroup.months.push(monthGroup);
    }

    monthGroup.episodes.push(episode);
  }

  return groups;
}

async function getDesignChunkExample(db: D1Database): Promise<DesignChunkExample | null> {
  return await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN episodes e ON e.id = c.episode_id
     ORDER BY CASE
       WHEN c.rich_content_json IS NOT NULL AND c.rich_content_json != '' AND c.rich_content_json != '[]' THEN 0
       ELSE 1
     END,
     e.published_date DESC,
     c.position ASC,
     c.id ASC
     LIMIT 1`
  ).first<DesignChunkExample>();
}

design.get("/", async (c) => {
  const [episodes, topics, connected, sampleChunk] = await Promise.all([
    getRecentEpisodes(c.env.DB, 8),
    getTopTopics(c.env.DB, 16),
    getMostConnected(c.env.DB, 5),
    getDesignChunkExample(c.env.DB),
  ]);

  const groupedEpisodes = groupEpisodesByYearMonth(episodes.slice(0, 6));
  const richBlocks = parseRichContentJson(sampleChunk?.rich_content_json || null);
  const richFootnotes = parseFootnotesJson(sampleChunk?.footnotes_json || null);
  const searchQuery = topics[0]?.name || "ecosystem";
  const topicExample = topics[0] || null;
  const liveRouteRows = [
    { href: "/", title: "Home", meta: "Latest panel, browse rows, and rail stack" },
    { href: "/episodes", title: "Episodes", meta: "Browse sections and date-driven scanning" },
    { href: `/search?q=${encodeURIComponent(searchQuery)}`, title: "Search", meta: "Search form plus chunk cards" },
    { href: "/topics", title: "Topics", meta: "Topic cloud and topic-detail patterns" },
    ...(sampleChunk ? [{ href: `/chunks/${sampleChunk.slug}`, title: sampleChunk.title, meta: "Chunk detail with rich source content" }] : []),
    ...(topicExample ? [{ href: `/topics/${topicExample.slug}`, title: topicExample.name, meta: "Topic detail with tabs and rail panels" }] : []),
  ];
  const designDecisions = [
    {
      href: "#foundations",
      title: "Content uses the content font; chrome uses the UI font",
      meta: "Typography follows the content-vs-chrome split rather than page-specific exceptions.",
    },
    {
      href: "#cards",
      title: "Browse uses rows; search uses chunk cards",
      meta: "Dense archive scanning and context-heavy discovery use different primitives on purpose.",
    },
    {
      href: "#topics",
      title: "Topics are navigation chips, not decorative badges",
      meta: "They stay compact, text-first, and tied directly to topic pages.",
    },
    {
      href: "#source-fidelity",
      title: "Rich source content is rendered from stored artifacts",
      meta: "Formatting, anchors, lists, and footnotes come from the same source-fidelity path used on live pages.",
    },
    {
      href: "#pagination",
      title: "Controls favor calm text and explicit state",
      meta: "Selections use the accent; passive states stay neutral.",
    },
  ];

  return c.html(
    <Layout
      title="Design"
      description="Bobbin's shared components and visual decisions"
      mainClassName="main-wide"
    >
      <div class="page-with-rail page-with-rail--aligned">
        <div class="page-body page-body-single">
          <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Design" }]} />

          <section class="page-preamble hero">
            <h1>Design</h1>
            <p>
              The system inventory for Bobbin. Every example below reuses the same
              components, layout shells, and stored content paths that already power the live site.
            </p>
          </section>

          <section id="overview" class="body-panel body-panel-list">
            <h2>Overview</h2>
            <p>
              This page is intentionally built from the real primitives rather than a parallel styleguide.
              It shows how the product combines editorial typography, browse rows, chunk cards, topic chips,
              rails, and source-fidelity rendering into one consistent system.
            </p>
            <BrowseRowList>
              {designDecisions.map((decision) => (
                <BrowseRow
                  key={decision.href}
                  href={decision.href}
                  title={decision.title}
                  meta={decision.meta}
                />
              ))}
            </BrowseRowList>
          </section>

          <section id="foundations" class="body-panel">
            <h2>Foundations</h2>
            <p>
              Bobbin keeps the reading surface editorial and calm: newsletter content stays in the content font,
              interface chrome stays in the UI font, and the warm panel shell is reused instead of inventing route-specific boxes.
            </p>
            <p>
              Accent color is reserved for action, emphasis, and active state. Ambient links and data displays stay more neutral,
              which keeps the hierarchy readable on text-heavy pages.
            </p>
          </section>

          <section id="navigation" class="body-panel">
            <h2>Navigation and search</h2>
            <p>
              Navigation is text-first. Search stays explicit and lightweight, and breadcrumb trails do the same work here that they do on chunk and episode pages.
            </p>
            <SearchForm query={searchQuery} />
          </section>

          <section id="cards" class="body-panel">
            <h2>Cards and index entries</h2>
            <p>
              Episode cards are compact archive entries. Chunk cards carry more context and are used where scanning excerpts matters, especially search.
            </p>
            {episodes.slice(0, 2).map((episode) => (
              <EpisodeCard key={episode.id} episode={episode} />
            ))}
            {sampleChunk && (
              <section class="search-results">
                <ChunkCard
                  chunk={sampleChunk}
                  episodeSlug={sampleChunk.episode_slug}
                  episodeTitle={sampleChunk.episode_title}
                  showEpisodeLink
                  query={searchQuery}
                />
              </section>
            )}
          </section>

          <section id="browse" class="body-panel">
            <h2>Browse primitives</h2>
            <p>
              Archive browsing reuses the same section, subsection, and row primitives across episodes, home, and chunk-side follow-ons.
            </p>
            {groupedEpisodes.length > 0 ? (
              groupedEpisodes.map((yearGroup) => (
                <BrowseSection key={yearGroup.year} title={yearGroup.year}>
                  {yearGroup.months.map((monthGroup) => (
                    <BrowseSubsection key={`${yearGroup.year}-${monthGroup.month}`} title={monthGroup.label}>
                      <BrowseRowList>
                        {monthGroup.episodes.map((episode) => (
                          <BrowseRow
                            key={episode.id}
                            href={`/episodes/${episode.slug}`}
                            title={episode.title}
                            meta={`${episode.published_date} · ${episode.chunk_count} chunk${episode.chunk_count === 1 ? "" : "s"}`}
                          />
                        ))}
                      </BrowseRowList>
                    </BrowseSubsection>
                  ))}
                </BrowseSection>
              ))
            ) : (
              <p>No episodes available yet.</p>
            )}
          </section>

          <section id="topics" class="body-panel">
            <h2>Topics and chips</h2>
            <p>
              Topics stay compact and navigational. The same topic cloud primitive scales from browsing surfaces to topic entry points without changing visual language.
            </p>
            {topics.length > 0 ? <TopicCloud topics={topics} /> : <p>No topics available yet.</p>}
          </section>

          <section id="source-fidelity" class="body-panel">
            <h2>Source fidelity</h2>
            <p>
              Rich content is rendered from stored source artifacts, not reconstructed ad hoc. That is what lets lists, links, anchors, and footnotes stay faithful on chunk and episode pages.
            </p>
            {sampleChunk && richBlocks.length > 0 ? (
              <>
                <p class="topic-observation-meta">
                  Example from <a href={`/chunks/${sampleChunk.slug}`}>{sampleChunk.title}</a>
                  {" "}in <a href={`/episodes/${sampleChunk.episode_slug}`}>{sampleChunk.episode_title}</a>.
                </p>
                <RichContent blocks={richBlocks} />
                <RichFootnotes footnotes={richFootnotes} />
              </>
            ) : (
              <p>No rich-content example is available in the current dataset.</p>
            )}
          </section>

          <section id="pagination" class="body-panel">
            <h2>Pagination</h2>
            <p>
              Pagination stays literal and low-drama: explicit previous and next links, an immediate page count, and no ornamental controls.
            </p>
            <Pagination currentPage={2} totalPages={5} baseUrl="/design?section=pagination" />
          </section>
        </div>

        <aside class="page-rail rail-stack">
          <section class="rail-panel page-toc">
            <h3>On this page</h3>
            <ol>
              <li><a href="#overview">Overview</a></li>
              <li><a href="#foundations">Foundations</a></li>
              <li><a href="#navigation">Navigation</a></li>
              <li><a href="#cards">Cards</a></li>
              <li><a href="#browse">Browse</a></li>
              <li><a href="#topics">Topics</a></li>
              <li><a href="#source-fidelity">Source fidelity</a></li>
              <li><a href="#pagination">Pagination</a></li>
            </ol>
          </section>

          <section class="rail-panel rail-panel-list">
            <h3>Live routes</h3>
            <BrowseRowList>
              {liveRouteRows.map((row) => (
                <BrowseRow key={row.href} href={row.href} title={row.title} meta={row.meta} />
              ))}
            </BrowseRowList>
          </section>

          {connected.length > 0 && (
            <section class="rail-panel rail-panel-list">
              <h3>Most connected</h3>
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
        </aside>
      </div>
    </Layout>
  );
});

export { design as designRoutes };
