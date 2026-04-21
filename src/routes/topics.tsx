import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { getTopicBySlug, getTopicChunkCount, getTopicChunks, getTopicSparkline, getTopicEpisodes, getTopicDiffChunks, getRelatedTopics, getTopicWordStats, getTopTopicsWithSparklines } from "../db/topics";
import { safeParseInt } from "../lib/html";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Pagination } from "../components/Pagination";
import { highlightInExcerpt, extractKWIC } from "../lib/highlight";

const topics = new Hono<AppEnv>();
const PAGE_SIZE = 20;

function distinctivenessGloss(d: number): string {
  if (d >= 50) return "exceptionally distinctive — among the signature concepts of the corpus";
  if (d >= 10) return "highly distinctive — appears far more often here than in everyday writing";
  if (d >= 3) return "moderately distinctive — clearly more present than in baseline language";
  return "near baseline frequency";
}

topics.get("/", async (c) => {
  const topicsWithSparklines = await getTopTopicsWithSparklines(c.env.DB, 20);

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
  const page = Math.max(1, safeParseInt(c.req.query("page"), 1));
  const offset = (page - 1) * PAGE_SIZE;

  const topic = await getTopicBySlug(c.env.DB, slug);
  if (!topic) return c.notFound();

  const [total, chunksList, episodes, sparkline, diffChunks, relatedTopics, wordStats] = await Promise.all([
    getTopicChunkCount(c.env.DB, topic.id),
    getTopicChunks(c.env.DB, topic.id, PAGE_SIZE, offset),
    getTopicEpisodes(c.env.DB, topic.id),
    getTopicSparkline(c.env.DB, topic.id),
    getTopicDiffChunks(c.env.DB, topic.id),
    getRelatedTopics(c.env.DB, topic.id),
    getTopicWordStats(c.env.DB, topic.name),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const maxSparkCount = Math.max(...sparkline.map((s: any) => s.count), 1);
  const topicPageRailClass = relatedTopics.length > 0 ? "page-rail topic-page-rail" : "page-rail topic-page-rail topic-page-rail--toc-only";

  return c.html(
    <Layout
      title={`Topic: ${topic.name}`}
      description={`Exploring "${topic.name}" across Bits and Bobs — ${total} chunks across ${episodes.length} episodes`}
      activePath="/topics"
      mainClassName="main-wide"
    >
      <div class="page-with-rail topic-detail-layout">
        <div class="page-body topic-detail-main">
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
              <span>
                {wordStats.distinctiveness.toFixed(1)}&times; distinctiveness vs baseline
              </span>
              <span class="topic-distinctiveness-gloss"> — {distinctivenessGloss(wordStats.distinctiveness)}</span>
              <span class="topic-distinctiveness-note"> compared with everyday baseline English.</span>
            </p>
          )}

          <script src="/scripts/toc-scrollspy.js" defer></script>

          {sparkline.length > 0 && (() => {
            const counts = sparkline.map((s: any) => s.count as number);
            const dates = sparkline.map((s: any) => s.published_date);
            const mean = counts.reduce((a: number, b: number) => a + b, 0) / counts.length;
            const max = maxSparkCount;
            const w = 500;
            const h = 80;
            const rugH = 10;
            const labelH = 16;
            const topPad = 12;
            const bottomPad = 4;
            const isSingle = counts.length === 1;
            const points = counts.map((c: number, i: number) => {
              const x = isSingle ? w / 2 : (i / (counts.length - 1)) * (w - bottomPad * 2) + bottomPad;
              const y = h - bottomPad - (c / max) * (h - topPad - bottomPad);
              return { x, y };
            });
            const meanY = h - bottomPad - (mean / max) * (h - topPad - bottomPad);
            const meanLabelY = Math.max(meanY - 3, 10);
            const landmarks = [
              { label: dates[0], x: bottomPad },
              { label: dates[Math.floor(dates.length / 2)], x: w / 2 },
              { label: dates[dates.length - 1], x: w - bottomPad },
            ];

            return (
              <section class="topic-sparkline" id="over-time" aria-label="Mentions over time">
                <svg viewBox={`0 0 ${w} ${h + rugH + labelH}`} class="topic-spark-svg" role="img">
                  {!isSingle && (
                    <>
                      <line x1={bottomPad} y1={meanY} x2={w - bottomPad} y2={meanY}
                        stroke="var(--border)" stroke-width="1" stroke-dasharray="4,3">
                        <title>{`Mean ${mean.toFixed(1)} mentions per episode across the full range`}</title>
                      </line>
                      <text x={w - bottomPad} y={meanLabelY} text-anchor="end"
                        fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">
                        avg {mean.toFixed(1)}
                        <title>{`Mean ${mean.toFixed(1)} mentions per episode across the full range`}</title>
                      </text>
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

          <section class="topic-chunks" id="in-context">
            <h2>In context</h2>
            {chunksList.map((r: any) => {
              const kwic = extractKWIC(r.content_plain || "", topic.name);
              return (
                <details key={r.id} class="kwic-row">
                  <summary>
                    <span class="kwic-line">
                      {kwic ? (
                        <>
                          <span class="kwic-left">{kwic.left}</span>
                          <span class="kwic-word">{topic.name}</span>
                          <span class="kwic-right">{kwic.right}</span>
                        </>
                      ) : (
                        <span class="kwic-word">{topic.name}</span>
                      )}
                    </span>
                    <span class="kwic-meta">{r.episode_title} · {r.published_date}</span>
                  </summary>
                  <div class="kwic-body">
                    <p
                      class="excerpt"
                      dangerouslySetInnerHTML={{
                        __html: highlightInExcerpt(r.content_plain || "", topic.name),
                      }}
                    />
                    <p class="kwic-source">
                      <a href={`/chunks/${r.slug}`}>{r.title}</a>
                      {" · from "}
                      <a href={`/episodes/${r.episode_slug}`}>{r.episode_title}</a>
                    </p>
                  </div>
                </details>
              );
            })}
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              baseUrl={`/topics/${slug}`}
            />
          </section>

          {diffChunks.length > 0 && (
            <section class="topic-evolution" id="evolution">
              <h2>Evolution over time</h2>
              <ol class="evolution-timeline">
                {diffChunks.map((r: any) => (
                  <li key={r.id} class="evolution-entry">
                    <time datetime={r.published_date}>{r.published_date}</time>
                    <a href={`/chunks/${r.slug}`} title={`From ${r.episode_title}`}>{r.title}</a>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <details class="topic-episode-timeline" id="episodes">
            <summary>
              <span class="topic-episode-summary">Episodes <span class="topic-episode-count">({episodes.length})</span></span>
            </summary>
            <div class="topic-episode-list">
              {episodes.map((ep: any) => {
                const barWidth = Math.round((ep.topic_chunk_count / Math.max(...episodes.map((e: any) => e.topic_chunk_count), 1)) * 100);
                return (
                  <a key={ep.id} href={`/episodes/${ep.slug}`} class="ep-density-row">
                    <time datetime={ep.published_date}>{ep.published_date}</time>
                    <div class="ep-density-main">
                      <span class="ep-density-title">{ep.title}</span>
                      <div class="ep-density-bar">
                        <div class="ep-density-fill" style={`width:${Math.max(barWidth, 2)}%`} />
                      </div>
                    </div>
                    <span class="ep-density-count">{ep.topic_chunk_count}</span>
                  </a>
                );
              })}
            </div>
          </details>
        </div>

        <aside class={topicPageRailClass}>
          <nav class="page-toc" aria-label="On this page">
            <h3>On this page</h3>
            <ol>
              {sparkline.length > 0 && <li><a href="#over-time">Over time</a></li>}
              <li><a href="#in-context">In context</a></li>
              {diffChunks.length > 0 && <li><a href="#evolution">Evolution</a></li>}
              <li><a href="#episodes">Episodes</a></li>
            </ol>
          </nav>
          {relatedTopics.length > 0 && (
            <section class="topic-related-panel">
              <h3>Related topics</h3>
              <div class="topics">
                {relatedTopics.map((rt) => (
                  <a
                    key={rt.slug}
                    href={`/topics/${rt.slug}`}
                    class="topic"
                  >
                    <span>{rt.name}</span>
                    <span class="topic-related-count">{rt.co_count} shared chunk{rt.co_count !== 1 ? "s" : ""}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </Layout>
  );
});

export { topics as topicRoutes };
