import { Hono } from "hono";
import type { AppEnv, TopicRow } from "../types";
import { Layout } from "../components/Layout";
import { SearchForm } from "../components/SearchForm";
import { ThemeRiver } from "../components/ThemeRiver";
import { getTopicBySlug, getTopicChunkCount, getTopicChunks, getTopicSparkline, getTopicEpisodes, getTopicDiffChunks, getRelatedTopics, getTopicWordStats, getTopTopicsWithSparklines, getTopicKWIC, getThemeRiverData, getTopicRanksByYear } from "../db/topics";
import { safeParseInt } from "../lib/html";
import { TopicCloud } from "../components/TopicCloud";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Pagination } from "../components/Pagination";
import { highlightInExcerpt, extractKWIC } from "../lib/highlight";

const topics = new Hono<AppEnv>();
const PAGE_SIZE = 20;

topics.get("/", async (c) => {
  const [topicsWithSparklines, multiWord, themeRiver] = await Promise.all([
    getTopTopicsWithSparklines(c.env.DB, 20),
    c.env.DB.prepare(
      "SELECT * FROM topics WHERE usage_count >= 3 AND name LIKE '% %' ORDER BY usage_count DESC LIMIT 20"
    ).all<TopicRow>(),
    getThemeRiverData(c.env.DB, 6),
  ]);

  const entities = multiWord.results;

  return c.html(
    <Layout title="Topics" description="Browse Bits and Bobs by topic" activePath="/topics">
      <SearchForm />

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
                <a key={topic.id} href={`/topics/${topic.slug}`} class="multiple-cell">
                  <span class="multiple-name">{topic.name}</span>
                  <span class="multiple-count">{topic.usage_count}</span>
                  <svg viewBox={`0 0 ${w} ${h}`} class="multiple-spark">
                    <polyline points={points} fill="none" stroke="var(--accent)" stroke-width="1.5" />
                  </svg>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <ThemeRiver data={themeRiver.data} dates={themeRiver.episodes} />

      {entities.length > 0 && (
        <section class="topic-tier">
          <h2>People, Products &amp; Phrases</h2>
          <TopicCloud topics={entities} />
        </section>
      )}

      <script src="/scripts/topic-filter.js" defer></script>
    </Layout>
  );
});

topics.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const page = Math.max(1, safeParseInt(c.req.query("page"), 1));
  const offset = (page - 1) * PAGE_SIZE;

  const topic = await getTopicBySlug(c.env.DB, slug);
  if (!topic) return c.notFound();

  const [total, chunksList, episodes, sparkline, diffChunks, relatedTopics, wordStats, kwicData, ranksByYear] = await Promise.all([
    getTopicChunkCount(c.env.DB, topic.id),
    getTopicChunks(c.env.DB, topic.id, PAGE_SIZE, offset),
    getTopicEpisodes(c.env.DB, topic.id),
    getTopicSparkline(c.env.DB, topic.id),
    getTopicDiffChunks(c.env.DB, topic.id),
    getRelatedTopics(c.env.DB, topic.id),
    getTopicWordStats(c.env.DB, topic.name),
    getTopicKWIC(c.env.DB, topic.name),
    getTopicRanksByYear(c.env.DB),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const maxSparkCount = Math.max(...sparkline.map((s: any) => s.count), 1);

  return c.html(
    <Layout
      title={`Topic: ${topic.name}`}
      description={`Exploring "${topic.name}" across Bits and Bobs — ${total} chunks across ${episodes.length} episodes`}
      activePath="/topics"
    >
      <Breadcrumbs
        crumbs={[
          { label: "Topics", href: "/topics" },
          { label: topic.name },
        ]}
      />
      <h1>Topic: {topic.name}</h1>
      <p class="topic-header-stats">
        {wordStats && (<><span class="topic-mentions">{wordStats.total_count.toLocaleString()} mentions</span> &middot; </>)}
        {total} chunk{total !== 1 ? "s" : ""} &middot; {episodes.length} episode
        {episodes.length !== 1 ? "s" : ""}
      </p>
      {wordStats && wordStats.distinctiveness > 0 && (
        <p class="topic-distinctiveness">
          {wordStats.distinctiveness.toFixed(1)}&times; distinctiveness vs baseline
        </p>
      )}

      {relatedTopics.length > 0 && (
        <nav class="topic-related">
          <span class="topic-related-label">Related:</span>{" "}
          {relatedTopics.map((rt, i) => (
            <>{i > 0 && " \u00B7 "}<a href={`/topics/${rt.slug}`}>{rt.name}</a></>
          ))}
        </nav>
      )}

      {/* Dispersion plot */}
      {sparkline.length > 0 && (() => {
        const w = 500, h = 20, pad = 2;
        const dates = sparkline.map((s: any) => s.published_date);
        const counts = sparkline.map((s: any) => s.count as number);
        const maxCount = Math.max(...counts, 1);

        return (
          <section class="topic-dispersion">
            <svg viewBox={`0 0 ${w} ${h}`} class="dispersion-svg">
              {dates.map((date: string, i: number) => {
                const x = dates.length === 1 ? w / 2 : (i / (dates.length - 1)) * (w - pad * 2) + pad;
                const opacity = 0.2 + (counts[i] / maxCount) * 0.8;
                return (
                  <rect key={i} x={x - 1} y={2} width={2.5} height={h - 4}
                    class="dispersion-mark"
                    fill="var(--accent)" opacity={opacity}
                    aria-label={`${date}: ${counts[i]}`} />
                );
              })}
            </svg>
            <div class="dispersion-dates">
              <span>{dates[0]}</span>
              <span>{dates[dates.length - 1]}</span>
            </div>
          </section>
        );
      })()}

      {/* Corpus level: SVG sparkline with mean line */}
      {sparkline.length > 1 && (() => {
        const counts = sparkline.map((s: any) => s.count as number);
        const mean = counts.reduce((a: number, b: number) => a + b, 0) / counts.length;
        const max = maxSparkCount;
        const w = 500;
        const h = 80;
        const pad = 4;

        const isSingle = counts.length === 1;
        const points = counts.map((c: number, i: number) => {
          const x = isSingle ? w / 2 : (i / (counts.length - 1)) * (w - pad * 2) + pad;
          const y = h - pad - (c / max) * (h - pad * 2);
          return { x, y };
        });

        const meanY = h - pad - (mean / max) * (h - pad * 2);

        // Date landmarks: first, middle, last
        const dates = sparkline.map((s: any) => s.published_date);
        const landmarks = [
          { label: dates[0], x: pad },
          { label: dates[Math.floor(dates.length / 2)], x: w / 2 },
          { label: dates[dates.length - 1], x: w - pad },
        ];

        return (
          <section class="topic-sparkline">
            <svg viewBox={`0 0 ${w} ${h + 16}`} class="topic-spark-svg">
              {/* Mean reference line */}
              <line x1={pad} y1={meanY} x2={w - pad} y2={meanY}
                stroke="var(--border)" stroke-width="1" stroke-dasharray="4,3" />
              <text x={w - pad} y={meanY - 3} text-anchor="end"
                fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">
                avg {mean.toFixed(1)}
              </text>

              {/* Sparkline */}
              {isSingle ? (
                <circle cx={points[0].x} cy={points[0].y} r="4"
                  fill="var(--accent)" />
              ) : (
                <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none"
                  stroke="var(--accent)" stroke-width="2" />
              )}

              {/* Date landmarks */}
              {landmarks.map((lm, i) => (
                <text key={i} x={lm.x} y={h + 12}
                  text-anchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                  fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">
                  {lm.label}
                </text>
              ))}
            </svg>
          </section>
        );
      })()}


      {/* Slopegraph: rank over time */}
      {(() => {
        // Extract this topic's rank per year
        const years = [...ranksByYear.keys()].sort();
        const topicYearData = years.map(year => {
          const yearTopics = ranksByYear.get(year)!;
          const entry = yearTopics.find(t => t.id === topic.id);
          return entry ? { year, rank: entry.rank, count: entry.count } : null;
        }).filter((d): d is { year: number; rank: number; count: number } => d !== null);

        if (topicYearData.length < 2) return null;

        const svgW = 300, svgH = 200, padX = 50, padY = 30;
        const maxRank = Math.max(...topicYearData.map(d => d.rank), 5);
        const yearList = topicYearData.map(d => d.year);
        const colWidth = yearList.length === 1 ? 0 : (svgW - padX * 2) / (yearList.length - 1);

        return (
          <section class="topic-slopegraph">
            <h2>Rank over time</h2>
            <svg viewBox={`0 0 ${svgW} ${svgH}`} class="slopegraph-svg">
              {/* Year columns */}
              {yearList.map((year, i) => {
                const x = padX + i * colWidth;
                return (
                  <text key={`year-${year}`} x={x} y={padY - 10} text-anchor="middle"
                    fill="var(--text-light)" font-size="11" font-family="var(--font-ui)" font-weight="600">
                    {year}
                  </text>
                );
              })}
              {/* Connecting lines between year dots */}
              {topicYearData.map((d, i) => {
                if (i === 0) return null;
                const x1 = padX + (i - 1) * colWidth;
                const y1 = padY + ((topicYearData[i - 1].rank - 1) / (Math.max(maxRank - 1, 1))) * (svgH - padY * 2);
                const x2 = padX + i * colWidth;
                const y2 = padY + ((d.rank - 1) / (Math.max(maxRank - 1, 1))) * (svgH - padY * 2);
                return (
                  <line key={`line-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="var(--accent)" stroke-width="2" opacity="0.6" />
                );
              })}
              {/* Dots and rank labels */}
              {topicYearData.map((d, i) => {
                const x = padX + i * colWidth;
                const y = padY + ((d.rank - 1) / (Math.max(maxRank - 1, 1))) * (svgH - padY * 2);
                return (
                  <g key={`dot-${i}`}>
                    <circle cx={x} cy={y} r="4" fill="var(--accent)" />
                    <text x={x + 8} y={y + 4} fill="var(--text)" font-size="10" font-family="var(--font-ui)">
                      #{d.rank}
                    </text>
                  </g>
                );
              })}
            </svg>
          </section>
        );
      })()}

      {/* KWIC (Key Word In Context) */}
      {kwicData.length > 0 && (
        <section class="topic-kwic">
          <h2>In context</h2>
          <table class="kwic-table">
            <tbody>
              {kwicData.map((row: any, i: number) => {
                const kwic = extractKWIC(row.content_plain, topic.name);
                if (!kwic) return null;
                return (
                  <tr key={i}>
                    <td class="kwic-left">{kwic.left}</td>
                    <td class="kwic-word"><a href={`/chunks/${row.slug}`}>{topic.name}</a></td>
                    <td class="kwic-right">{kwic.right}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Episode level: horizontal density bars */}
      <section class="topic-episode-timeline">
        <h2>Episodes</h2>
        {episodes.map((ep: any) => {
          const barWidth = Math.round((ep.topic_chunk_count / Math.max(...episodes.map((e: any) => e.topic_chunk_count), 1)) * 100);
          return (
            <a key={ep.id} href={`/episodes/${ep.slug}`} class="ep-density-row">
              <time datetime={ep.published_date}>{ep.published_date}</time>
              <div class="ep-density-bar">
                <div class="ep-density-fill" style={`width:${Math.max(barWidth, 2)}%`} />
              </div>
              <span class="ep-density-count">{ep.topic_chunk_count}</span>
            </a>
          );
        })}
      </section>

      {/* Diff: collapsible evolution view */}
      <details class="topic-diff-section">
        <summary>Evolution over time</summary>
        <div class="diff-view">
          {diffChunks.map((r: any, i: number) => (
            <article key={r.id} class="diff-entry">
              <div class="diff-date">
                <time datetime={r.published_date}>{r.published_date}</time>
              </div>
              <div class="diff-content">
                <a href={`/chunks/${r.slug}`}>{r.title}</a>
              </div>
            </article>
          ))}
        </div>
      </details>

      {/* Observation list */}
      <section class="topic-chunks">
        <h2>Observations</h2>
        {chunksList.map((r: any) => (
          <article key={r.id} class="chunk-card">
            <h3>
              <a href={`/chunks/${r.slug}`}>{r.title}</a>
            </h3>
            <span class="episode-link">
              from <a href={`/episodes/${r.episode_slug}`}>{r.episode_title}</a>
            </span>
            <p
              class="excerpt"
              dangerouslySetInnerHTML={{
                __html: highlightInExcerpt(r.content_plain || "", topic.name),
              }}
            />
          </article>
        ))}
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          baseUrl={`/topics/${slug}`}
        />
      </section>

    </Layout>
  );
});

export { topics as topicRoutes };
