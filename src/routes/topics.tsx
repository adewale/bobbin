import { Hono } from "hono";
import type { AppEnv, TopicRow, ChunkRow } from "../types";
import { Layout } from "../components/Layout";
import { SearchForm } from "../components/SearchForm";
import { getFilteredTopics, getTopicBySlug, getTopicChunkCount, getTopicChunks, getTopicSparkline, getTopicEpisodes, getTopicDiffChunks } from "../db/topics";
import { safeParseInt } from "../lib/html";
import { TopicCloud } from "../components/TopicCloud";
import { ChunkCard } from "../components/ChunkCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Pagination } from "../components/Pagination";

const topics = new Hono<AppEnv>();
const PAGE_SIZE = 20;

topics.get("/", async (c) => {
  // Three tiers: multi-word entities, proper nouns, domain concepts
  const [multiWord, properNouns, conceptResults] = await Promise.all([
    // Multi-word entities: "claude code", "simon willison"
    c.env.DB.prepare(
      "SELECT * FROM topics WHERE usage_count >= 3 AND name LIKE '% %' ORDER BY usage_count DESC LIMIT 20"
    ).all<TopicRow>(),
    // Distinctive domain terms: not in baseline, high distinctiveness
    c.env.DB.prepare(
      `SELECT t.* FROM topics t
       JOIN word_stats c ON c.word = t.name
       WHERE t.usage_count >= 5 AND t.name NOT LIKE '% %'
         AND c.in_baseline = 0 AND c.distinctiveness >= 10
       ORDER BY c.distinctiveness DESC LIMIT 20`
    ).all<TopicRow>(),
    // Domain concepts: ranked by usage × distinctiveness
    c.env.DB.prepare(
      `SELECT t.*, COALESCE(c.distinctiveness, 0) as dist
       FROM topics t
       LEFT JOIN word_stats c ON c.word = t.name
       WHERE t.usage_count >= 3 AND t.name NOT LIKE '% %'
       ORDER BY t.usage_count * COALESCE(c.distinctiveness, 1) DESC
       LIMIT 80`
    ).all<TopicRow>(),
  ]);
  const entities = multiWord.results;
  const entitySlugs = new Set(entities.map(t => t.slug));
  // Merge distinctive proper nouns into the concept list (they'll rank high)
  const conceptSlugs = new Set(conceptResults.results.map(t => t.slug));
  const extraNouns = properNouns.results.filter(t => !entitySlugs.has(t.slug) && !conceptSlugs.has(t.slug));
  const concepts = [...conceptResults.results, ...extraNouns]
    .filter(t => !entitySlugs.has(t.slug))
    .slice(0, 80);

  return c.html(
    <Layout title="Topics" description="Browse Bits and Bobs by topic" activePath="/topics">
      <SearchForm />

      {entities.length > 0 && (
        <section class="topic-tier">
          <h2>People, Products &amp; Phrases</h2>
          <TopicCloud topics={entities} />
        </section>
      )}

      <section class="topic-tier">
        <h2>Key Concepts</h2>
        <TopicCloud topics={concepts} />
      </section>

      <script src="/scripts/tag-filter.js" defer></script>
    </Layout>
  );
});

topics.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const page = Math.max(1, safeParseInt(c.req.query("page"), 1));
  const offset = (page - 1) * PAGE_SIZE;

  const topic = await getTopicBySlug(c.env.DB, slug);
  if (!topic) return c.notFound();

  const [total, chunksList, episodes, sparkline, diffChunks] = await Promise.all([
    getTopicChunkCount(c.env.DB, topic.id),
    getTopicChunks(c.env.DB, topic.id, PAGE_SIZE, offset),
    getTopicEpisodes(c.env.DB, topic.id),
    getTopicSparkline(c.env.DB, topic.id),
    getTopicDiffChunks(c.env.DB, topic.id),
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
      <p>
        {total} chunk{total !== 1 ? "s" : ""} across {episodes.length} episode
        {episodes.length !== 1 ? "s" : ""}
      </p>

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
        {chunksList.map((r) => (
          <ChunkCard
            key={r.id}
            chunk={r as ChunkRow}
            episodeSlug={r.episode_slug}
            episodeTitle={r.episode_title}
            showEpisodeLink
          />
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
