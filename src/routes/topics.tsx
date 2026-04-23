import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { getAdjacentTopics, getRelatedTopics, getTopTopicsWithSparklines, getTopicBySlug, getTopicChunkCount, getTopicChunks, getTopicDriftChunks, getTopicEpisodes, getTopicRankHistory, getTopicSparkline, getTopicWordStats } from "../db/topics";
import { safeParseInt } from "../lib/html";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Pagination } from "../components/Pagination";
import { highlightInExcerpt } from "../lib/highlight";
import { buildTerminologyDrift, buildTopicSummary } from "../lib/topic-detail";

const topics = new Hono<AppEnv>();
const PAGE_SIZE = 20;

function buildTopicPath(slug: string, params: { sort?: string; page?: number }) {
  const search = new URLSearchParams();

  if (params.sort && params.sort !== "newest") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));

  const query = search.toString();
  return query ? `/topics/${slug}?${query}` : `/topics/${slug}`;
}

function HelpTip(props: { label: string; text: string }) {
  return (
    <details class="topic-help-tip">
      <summary aria-label={props.label} title={props.label}>?</summary>
      <div class="topic-help-tip-bubble" role="note">{props.text}</div>
    </details>
  );
}

topics.get("/", async (c) => {
  const topicsWithSparklines = await getTopTopicsWithSparklines(c.env.DB);

  return c.html(
    <Layout title="Topics" description="Browse Bits and Bobs by topic" activePath="/topics" mainClassName="main-wide">
      <p class="page-intro">Concepts ranked by how their attention shifts across the corpus — spikes, trends, and fades.</p>

      {topicsWithSparklines.length > 0 && (
        <section class="topic-multiples">
          <div class="multiples-grid">
            {topicsWithSparklines.map(topic => {
              const max = Math.max(...topic.sparkline, 1);
              const w = 120, h = 40, pad = 2;
              const points = topic.sparkline.map((v: number, i: number) => {
                const x = topic.sparkline.length === 1 ? w / 2 : (i / (topic.sparkline.length - 1)) * (w - pad * 2) + pad;
                const y = h - pad - (v / max) * (h - pad * 2);
                return `${x},${y}`;
              }).join(" ");

              return (
                <a
                  key={topic.id}
                  href={`/topics/${topic.slug}`}
                  class="multiple-cell"
                  title={`${topic.name} — ${topic.usage_count} chunk${topic.usage_count !== 1 ? "s" : ""}`}
                >
                  <span class="multiple-name">{topic.name}</span>
                  <span class="multiple-count">{topic.usage_count}</span>
                  <svg viewBox={`0 0 ${w} ${h}`} class="multiple-spark" role="img" aria-label={`Usage trend for ${topic.name}`}>
                    <title>{`${topic.name}: ${topic.usage_count} chunks`}</title>
                    <polyline points={points} fill="none" stroke="var(--accent)" stroke-width="1.5" />
                  </svg>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <script src="/scripts/topic-filter.js" defer></script>
    </Layout>
  );
});

topics.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const requestedPage = Math.max(1, safeParseInt(c.req.query("page"), 1));
  const observationSort = c.req.query("sort") === "oldest" ? "oldest" : "newest";

  const topic = await getTopicBySlug(c.env.DB, slug);
  if (!topic) return c.notFound();

  const [total, driftChunks, episodes, sparkline, relatedTopics, wordStats, rankHistory, adjacentTopics] = await Promise.all([
    getTopicChunkCount(c.env.DB, topic.id),
    getTopicDriftChunks(c.env.DB, topic.id),
    getTopicEpisodes(c.env.DB, topic.id),
    getTopicSparkline(c.env.DB, topic.id),
    getRelatedTopics(c.env.DB, topic.id),
    getTopicWordStats(c.env.DB, topic.name),
    getTopicRankHistory(c.env.DB, topic.id),
    getAdjacentTopics(c.env.DB, topic.id),
  ]);

  const totalObservationCount = total;
  const totalPages = Math.max(1, Math.ceil(totalObservationCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;
  const observationsPage = await getTopicChunks(c.env.DB, topic.id, PAGE_SIZE, offset, observationSort);
  const maxSparkCount = Math.max(...sparkline.map((s: any) => s.count), 1);
  const topicPageRailClass = "page-rail topic-page-rail rail-stack";
  const peakEpisode = episodes.reduce((best: any | null, episode: any) => {
    if (!best || episode.topic_chunk_count > best.topic_chunk_count) return episode;
    return best;
  }, null);
  const editorialSummary = buildTopicSummary({
    topicName: topic.name,
    totalChunks: total,
    totalEpisodes: episodes.length,
    firstPublishedDate: episodes[0]?.published_date,
    lastPublishedDate: episodes[episodes.length - 1]?.published_date,
    peakEpisode,
    relatedTopics,
    rankHistory,
    aboveTopic: adjacentTopics.above,
    belowTopic: adjacentTopics.below,
  });
  const terminologyDrift = buildTerminologyDrift(driftChunks, topic.name);
  const hasDrift = terminologyDrift.earlier.length > 0 || terminologyDrift.later.length > 0;

  const topicTabs = [
    { id: "observations", label: "Observations" },
    ...(hasDrift ? [{ id: "drift", label: "Drift" }] : []),
  ];
  const hasRailPanels = rankHistory.length > 0 || adjacentTopics.above || adjacentTopics.below;
  const observationBaseUrl = buildTopicPath(slug, {
    sort: observationSort,
  });
  const topicLayoutClass = hasRailPanels
    ? "page-with-rail page-with-rail--aligned topic-detail-layout"
    : "topic-detail-layout topic-detail-layout--solo";

  return c.html(
    <Layout
      title={`Topic: ${topic.name}`}
      description={`Exploring "${topic.name}" across Bits and Bobs — ${total} chunks across ${episodes.length} episodes`}
      activePath="/topics"
      mainClassName="main-wide"
    >
      <div class={topicLayoutClass}>
        <div class="page-body topic-detail-main">
          <div class="page-preamble">
            <Breadcrumbs
              crumbs={[
                { label: "Topics", href: "/topics" },
                { label: topic.name },
              ]}
            />
          </div>

          <h1>Topic: {topic.name}</h1>
          <div class="topic-stats-row">
            <p class="topic-header-stats">
              {wordStats && (<><span class="topic-mentions">{wordStats.total_count.toLocaleString()} mentions</span> &middot; </>)}
              {total} chunk{total !== 1 ? "s" : ""} &middot; {episodes.length} episode
              {episodes.length !== 1 ? "s" : ""}
            </p>
            {wordStats && wordStats.distinctiveness > 0 && (
              <div class="topic-distinctiveness topic-inline-heading-row">
                <span>{wordStats.distinctiveness.toFixed(1)}&times; distinctiveness vs baseline</span>
                <HelpTip
                  label="Explain distinctiveness"
                  text="How much more common this term is here than in ordinary English. Higher values mean the topic is more characteristic of this corpus."
                />
              </div>
            )}
          </div>

          {relatedTopics.length > 0 && (
            <div class="topic-related topic-related-inline">
              <span class="topic-inline-heading-row">
                <span class="topic-related-label">Related:</span>
                <HelpTip
                  label="Explain related topics"
                  text="Topics that appear in the same chunks as this one. Use this to find semantic neighbors, not ranking neighbors."
                />
              </span>{" "}
              {relatedTopics.map((rt, index) => (
                <span key={rt.slug}>
                  {index > 0 ? " · " : ""}
                  <a href={`/topics/${rt.slug}`}>{rt.name}</a>
                </span>
              ))}
            </div>
          )}

          {editorialSummary.length > 0 && (
            <section class="topic-summary body-panel" aria-labelledby="topic-summary-heading">
              <div class="topic-section-heading-row">
                <h2 id="topic-summary-heading">Topic summary</h2>
                <HelpTip
                  label="Explain topic summary"
                  text="A short read on the topic's time range, peak episode, and strongest associations. Use it as the quick orientation before drilling into examples."
                />
              </div>
              <ul class="topic-summary-list">
                {editorialSummary.map((line, index) => (
                  <li key={`${topic.slug}-summary-${index}`}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          <script src="/scripts/topic-detail-tabs.js" defer></script>

          {sparkline.length > 0 && (() => {
            const counts = sparkline.map((s: any) => s.count as number);
            const dates = sparkline.map((s: any) => s.published_date);
            const mean = counts.reduce((a: number, b: number) => a + b, 0) / counts.length;
            const max = maxSparkCount;
            const w = 500;
            const h = 68;
            const rugH = 8;
            const labelH = 14;
            const topPad = 10;
            const bottomPad = 4;
            const isSingle = counts.length === 1;
            const peakPoint = counts.reduce((best, count, index) => {
              if (count > best.count) return { count, date: dates[index] };
              return best;
            }, { count: counts[0], date: dates[0] });
            const points = counts.map((c: number, i: number) => {
              const x = isSingle ? w / 2 : (i / (counts.length - 1)) * (w - bottomPad * 2) + bottomPad;
              const y = h - bottomPad - (c / max) * (h - topPad - bottomPad);
              return { x, y };
            });
            const meanY = h - bottomPad - (mean / max) * (h - topPad - bottomPad);
            const landmarks = dates.length > 18
              ? [
                  { label: dates[0], x: bottomPad },
                  { label: dates[dates.length - 1], x: w - bottomPad },
                ]
              : [
                  { label: dates[0], x: bottomPad },
                  { label: dates[Math.floor(dates.length / 2)], x: w / 2 },
                  { label: dates[dates.length - 1], x: w - bottomPad },
                ];

            return (
              <section class="topic-sparkline" id="over-time" aria-label="Mentions over time">
                <div class="topic-section-heading-row">
                  <h2>Over time</h2>
                  <HelpTip
                    label="Explain mentions over time"
                    text="Raw mentions over time. Use this to see absolute attention, not relative rank among all topics."
                  />
                </div>
                <div class="topic-sparkline-meta">
                  <span><strong>Range</strong>{dates[0]} to {dates[dates.length - 1]}</span>
                  {!isSingle && <span><strong>Mean</strong>{mean.toFixed(1)} per episode</span>}
                  <span><strong>Peak</strong>{peakPoint.count} on {peakPoint.date}</span>
                </div>
                <svg viewBox={`0 0 ${w} ${h + rugH + labelH}`} class="topic-spark-svg" role="img">
                  {!isSingle && (
                    <>
                      <line x1={bottomPad} y1={meanY} x2={w - bottomPad} y2={meanY}
                        stroke="var(--border)" stroke-width="1" stroke-dasharray="4,3">
                        <title>{`Mean ${mean.toFixed(1)} mentions per episode across the full range`}</title>
                      </line>
                    </>
                  )}

                  {isSingle ? (
                    <circle cx={points[0].x} cy={points[0].y} r="4" fill="var(--accent)">
                      <title>{`${dates[0]}: ${counts[0]} mention${counts[0] !== 1 ? "s" : ""}`}</title>
                    </circle>
                  ) : (
                    <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none"
                      stroke="var(--accent)" stroke-width="2" />
                  )}

                  {!isSingle && points.map((p, i) => (
                    <circle key={`pt-${i}`} cx={p.x} cy={p.y} r="5" fill="transparent" pointer-events="all">
                      <title>{`${dates[i]}: ${counts[i]} mention${counts[i] !== 1 ? "s" : ""}`}</title>
                    </circle>
                  ))}

                  {dates.map((date: string, i: number) => {
                    const x = isSingle ? w / 2 : (i / Math.max(dates.length - 1, 1)) * (w - bottomPad * 2) + bottomPad;
                    const opacity = 0.2 + (counts[i] / max) * 0.8;
                    return (
                      <rect key={`rug-${i}`} x={x - 1} y={h + 1} width={2} height={rugH - 2}
                        class="dispersion-mark"
                        fill="var(--accent)" opacity={opacity}>
                        <title>{`${date}: ${counts[i]}`}</title>
                      </rect>
                    );
                  })}

                  {landmarks.map((lm, i) => (
                    <text key={`lm-${i}`} x={lm.x} y={h + rugH + 12}
                      text-anchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                      fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">
                      {lm.label}
                    </text>
                  ))}
                </svg>
              </section>
            );
          })()}

          <nav class="topic-tabs" aria-label="Topic sections" data-topic-tab-list role="tablist">
            {topicTabs.map((tab, index) => (
              <a
                key={tab.id}
                href={`#${tab.id}`}
                class={`topic-tab-link${index === 0 ? " is-active" : ""}`}
                id={`tab-${tab.id}`}
                data-topic-tab={tab.id}
                role="tab"
                aria-controls={tab.id}
                aria-selected={index === 0 ? "true" : "false"}
                {...(index === 0 ? { "aria-current": "page" } : {})}
              >
                {tab.label}
              </a>
            ))}
          </nav>

          <section class="topic-tab-panel topic-observations" id="observations" data-topic-tab-panel="observations" role="tabpanel" aria-labelledby="tab-observations">
            <div class="topic-section-heading-row">
              <h2>Observations</h2>
              <HelpTip
                label="Explain observations"
                text="The primary evidence view for this topic. Sort it chronologically when you want concrete examples behind the larger pattern."
              />
            </div>
            <div class="topic-observation-controls" aria-label="Observation controls">
              <div class="topic-control-group">
                <span class="topic-control-label">Order</span>
                <a
                  href={`${buildTopicPath(slug, { sort: "newest" })}#observations`}
                  data-topic-observation-nav="sort"
                  data-topic-observation-sort="newest"
                  class={`topic-control-chip${observationSort === "newest" ? " is-active" : ""}`}
                  {...(observationSort === "newest" ? { "aria-current": "page" } : {})}
                >
                  Newest first
                </a>
                <a
                  href={`${buildTopicPath(slug, { sort: "oldest" })}#observations`}
                  data-topic-observation-nav="sort"
                  data-topic-observation-sort="oldest"
                  class={`topic-control-chip${observationSort === "oldest" ? " is-active" : ""}`}
                  {...(observationSort === "oldest" ? { "aria-current": "page" } : {})}
                >
                  Oldest first
                </a>
              </div>
            </div>
            <p class="topic-observation-note">
              {`Showing ${totalObservationCount} observation${totalObservationCount === 1 ? "" : "s"} sorted ${observationSort === "oldest" ? "from earliest to latest" : "from latest to earliest"}.`}
            </p>
            <div class="topic-observation-list">
              {observationsPage.map((r: any) => (
                <article key={r.id} class="topic-observation-card">
                  <h3><a href={`/chunks/${r.slug}`}>{r.title}</a></h3>
                  <p class="topic-observation-meta">
                    from <a href={`/episodes/${r.episode_slug}`}>{r.episode_title}</a> &middot; <time datetime={r.published_date}>{r.published_date}</time>
                  </p>
                  <p
                    class="topic-observation-excerpt"
                    dangerouslySetInnerHTML={{
                      __html: highlightInExcerpt(r.content_plain || "", topic.name),
                    }}
                  />
                </article>
              ))}
            </div>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              baseUrl={observationBaseUrl}
            />
          </section>

          {hasDrift && (
            <section class="topic-tab-panel topic-drift" id="drift" data-topic-tab-panel="drift" role="tabpanel" aria-labelledby="tab-drift">
              <div class="topic-section-heading-row">
                <h2>Terminology drift</h2>
                <HelpTip
                  label="Explain terminology drift"
                  text="Recurring two-word phrases that become less or more associated with the topic over time. Use this to spot framing changes rather than individual examples."
                />
              </div>
              <div class="topic-drift-columns">
                <section>
                  <h3>Earlier framing</h3>
                  <ul class="topic-drift-list">
                    {terminologyDrift.earlier.map((term) => (
                      <li key={`earlier-${term.phrase}`}>
                        <span class="topic-drift-word">{term.phrase}</span>
                        <span class="topic-drift-shift">{term.earlyCount} &rarr; {term.lateCount}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Later framing</h3>
                  <ul class="topic-drift-list">
                    {terminologyDrift.later.map((term) => (
                      <li key={`later-${term.phrase}`}>
                        <span class="topic-drift-word">{term.phrase}</span>
                        <span class="topic-drift-shift">{term.earlyCount} &rarr; {term.lateCount}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </section>
          )}
        </div>

        {hasRailPanels && (
          <aside class={topicPageRailClass}>
            {rankHistory.length > 0 && (() => {
              const width = 180;
              const height = 72;
              const pad = 10;
              const maxRank = Math.max(...rankHistory.map((point) => point.rank), 1);
              const isSingle = rankHistory.length === 1;
              const points = rankHistory.map((point, index) => {
                const x = isSingle ? width / 2 : pad + (index / Math.max(rankHistory.length - 1, 1)) * (width - pad * 2);
                const y = maxRank === 1
                  ? height / 2
                  : pad + ((point.rank - 1) / Math.max(maxRank - 1, 1)) * (height - pad * 2);

                return { ...point, x, y };
              });

              return (
                <section class="topic-rank-panel rail-panel">
                  <div class="rail-panel-heading-row">
                    <h3>Rank over time</h3>
                    <HelpTip
                      label="Explain rank over time"
                      text="Relative position among all topics by year. Unlike the chart above, this shows rank, not raw mentions."
                    />
                  </div>
                  <svg viewBox={`0 0 ${width} ${height + 16}`} class="topic-rank-svg rail-sparkline" role="img" aria-label={`Rank over time for ${topic.name}`}>
                    {!isSingle && (
                      <polyline
                        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="var(--accent)"
                        stroke-width="2"
                      />
                    )}
                    {points.map((point) => (
                      <g key={`rank-${point.year}`}>
                        <circle cx={point.x} cy={point.y} r="3.5" fill="var(--accent)">
                          <title>{`${point.year}: #${point.rank} (${point.count} chunks)`}</title>
                        </circle>
                        <text x={point.x} y={height + 12} text-anchor="middle" fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">
                          {point.year}
                        </text>
                      </g>
                    ))}
                  </svg>
                  <p class="topic-rank-caption">
                    #{rankHistory[0].rank} in {rankHistory[0].year}
                    {rankHistory.length > 1 ? ` · #${rankHistory[rankHistory.length - 1].rank} in ${rankHistory[rankHistory.length - 1].year}` : ""}
                  </p>
                </section>
              );
            })()}

            {(adjacentTopics.above || adjacentTopics.below) && (
              <section class="rail-panel">
                <div class="rail-panel-heading-row">
                  <h3>Adjacent topics</h3>
                  <HelpTip
                    label="Explain adjacent topics"
                    text="Topics just above or below this one by overall chunk volume. These are ranking neighbors, not semantic neighbors."
                  />
                </div>
                <div class="topic-adjacent-list">
                  {adjacentTopics.above && (
                    <p>
                      <span class="topic-adjacent-label">Above</span>
                      <a href={`/topics/${adjacentTopics.above.slug}`}>{adjacentTopics.above.name}</a>
                      <span class="topic-adjacent-meta">{adjacentTopics.above.usage_count} chunks</span>
                    </p>
                  )}
                  {adjacentTopics.below && (
                    <p>
                      <span class="topic-adjacent-label">Below</span>
                      <a href={`/topics/${adjacentTopics.below.slug}`}>{adjacentTopics.below.name}</a>
                      <span class="topic-adjacent-meta">{adjacentTopics.below.usage_count} chunks</span>
                    </p>
                  )}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>
    </Layout>
  );
});

export { topics as topicRoutes };
