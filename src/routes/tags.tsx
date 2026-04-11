import { Hono } from "hono";
import type { AppEnv, TagRow, ChunkRow } from "../types";
import { Layout } from "../components/Layout";
import { escapeXml, getBaseUrl } from "../lib/html";
import { SearchForm } from "../components/SearchForm";
import { TagCloud } from "../components/TagCloud";
import { ChunkCard } from "../components/ChunkCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Pagination } from "../components/Pagination";

const tags = new Hono<AppEnv>();
const PAGE_SIZE = 20;

tags.get("/", async (c) => {
  // Only load tags with meaningful usage — not all 9000
  const topTags = await c.env.DB.prepare(
    "SELECT * FROM tags WHERE usage_count >= 3 ORDER BY usage_count DESC LIMIT 200"
  ).all<TagRow>();

  const entities = topTags.results.filter((t) => t.name.includes(" ")).slice(0, 20);
  const concepts = topTags.results.filter((t) => !t.name.includes(" ")).slice(0, 40);

  return c.html(
    <Layout title="Tags" description="Browse Bits and Bobs by topic" activePath="/tags">
      <SearchForm />

      {entities.length > 0 && (
        <section class="tag-tier">
          <h2>People, Products &amp; Phrases</h2>
          <TagCloud tags={entities} />
        </section>
      )}

      <section class="tag-tier">
        <h2>Key Concepts</h2>
        <TagCloud tags={concepts} />
      </section>

      <script src="/scripts/tag-filter.js" defer></script>
    </Layout>
  );
});

tags.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const tag = await c.env.DB.prepare("SELECT * FROM tags WHERE slug = ?")
    .bind(slug)
    .first<TagRow>();

  if (!tag) return c.notFound();

  // All queries in parallel for the ladder of abstraction
  const [countResult, chunksResult, episodeTimeline, sparklineData] =
    await Promise.all([
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM chunk_tags WHERE tag_id = ?"
      )
        .bind(tag.id)
        .first(),
      c.env.DB.prepare(
        `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
         FROM chunks c
         JOIN chunk_tags ct ON c.id = ct.chunk_id
         JOIN episodes e ON c.episode_id = e.id
         WHERE ct.tag_id = ?
         ORDER BY e.published_date DESC
         LIMIT ? OFFSET ?`
      )
        .bind(tag.id, PAGE_SIZE, offset)
        .all(),
      // Episode-level: which episodes contain this tag
      c.env.DB.prepare(
        `SELECT e.*, COUNT(ct.chunk_id) as tag_chunk_count
         FROM episodes e
         JOIN episode_tags et ON e.id = et.episode_id
         JOIN chunk_tags ct ON ct.tag_id = et.tag_id AND ct.tag_id = ?
         JOIN chunks c ON c.id = ct.chunk_id AND c.episode_id = e.id
         WHERE et.tag_id = ?
         GROUP BY e.id
         ORDER BY e.published_date ASC`
      )
        .bind(tag.id, tag.id)
        .all(),
      // Corpus-level: usage count per episode over time
      c.env.DB.prepare(
        `SELECT e.published_date, COUNT(ct.chunk_id) as count
         FROM chunk_tags ct
         JOIN chunks c ON ct.chunk_id = c.id
         JOIN episodes e ON c.episode_id = e.id
         WHERE ct.tag_id = ?
         GROUP BY e.id
         ORDER BY e.published_date ASC`
      )
        .bind(tag.id)
        .all(),
    ]);

  const total = (countResult as any)?.count || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const chunksList = chunksResult.results as any[];
  const episodes = episodeTimeline.results as any[];
  const sparkline = sparklineData.results as any[];
  const maxSparkCount = Math.max(...sparkline.map((s: any) => s.count), 1);

  return c.html(
    <Layout
      title={`Tag: ${tag.name}`}
      description={`Exploring "${tag.name}" across Bits and Bobs — ${total} chunks across ${episodes.length} episodes`}
      activePath="/tags"
    >
      <Breadcrumbs
        crumbs={[
          { label: "Tags", href: "/tags" },
          { label: tag.name },
        ]}
      />
      <h1>Tag: {tag.name}</h1>
      <p>
        {total} observation{total !== 1 ? "s" : ""} across {episodes.length} episode
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

        const points = counts.map((c: number, i: number) => {
          const x = (i / (counts.length - 1)) * (w - pad * 2) + pad;
          const y = h - pad - (c / max) * (h - pad * 2);
          return `${x},${y}`;
        }).join(" ");

        const meanY = h - pad - (mean / max) * (h - pad * 2);

        // Date landmarks: first, middle, last
        const dates = sparkline.map((s: any) => s.published_date);
        const landmarks = [
          { label: dates[0], x: pad },
          { label: dates[Math.floor(dates.length / 2)], x: w / 2 },
          { label: dates[dates.length - 1], x: w - pad },
        ];

        return (
          <section class="tag-sparkline">
            <svg viewBox={`0 0 ${w} ${h + 16}`} class="tag-spark-svg">
              {/* Mean reference line */}
              <line x1={pad} y1={meanY} x2={w - pad} y2={meanY}
                stroke="var(--border)" stroke-width="1" stroke-dasharray="4,3" />
              <text x={w - pad} y={meanY - 3} text-anchor="end"
                fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">
                avg {mean.toFixed(1)}
              </text>

              {/* Sparkline */}
              <polyline points={points} fill="none"
                stroke="var(--accent)" stroke-width="2" />

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
      <section class="tag-episode-timeline">
        <h2>Episodes</h2>
        {episodes.map((ep: any) => {
          const barWidth = Math.round((ep.tag_chunk_count / Math.max(...episodes.map((e: any) => e.tag_chunk_count), 1)) * 100);
          return (
            <a key={ep.id} href={`/episodes/${ep.slug}`} class="ep-density-row">
              <time datetime={ep.published_date}>{ep.published_date}</time>
              <div class="ep-density-bar">
                <div class="ep-density-fill" style={`width:${Math.max(barWidth, 2)}%`} />
              </div>
              <span class="ep-density-count">{ep.tag_chunk_count}</span>
            </a>
          );
        })}
      </section>

      {/* Diff: collapsible evolution view */}
      <details class="tag-diff-section">
        <summary>Evolution over time</summary>
        <div class="diff-view">
          {chunksList.slice(0, 20).map((r: any, i: number) => (
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
      <section class="tag-chunks">
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
          baseUrl={`/tags/${slug}`}
        />
      </section>

    </Layout>
  );
});

// Feature 4: Diff-over-time view for a tag
tags.get("/:slug/diff", async (c) => {
  const slug = c.req.param("slug");
  const tag = await c.env.DB.prepare("SELECT * FROM tags WHERE slug = ?")
    .bind(slug)
    .first<TagRow>();

  if (!tag) return c.notFound();

  const chunks = await c.env.DB.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_tags ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.tag_id = ?
     ORDER BY e.published_date ASC`
  )
    .bind(tag.id)
    .all();

  return c.html(
    <Layout
      title={`"${tag.name}" over time`}
      activePath="/tags"
      description={`How Komoroske's thinking on "${tag.name}" has evolved`}
    >
      <Breadcrumbs
        crumbs={[
          { label: "Tags", href: "/tags" },
          { label: tag.name, href: `/tags/${tag.slug}` },
          { label: "Diff" },
        ]}
      />
      <h1>&ldquo;{tag.name}&rdquo; over time</h1>
      <div class="diff-view">
        {(chunks.results as any[]).map((r, i) => (
          <article key={r.id} class="diff-entry">
            <div class="diff-date">
              <time datetime={r.published_date}>{r.published_date}</time>
              <a href={`/episodes/${r.episode_slug}`}>{r.episode_title}</a>
            </div>
            <div class="diff-content">
              <h2><a href={`/chunks/${r.slug}`}>{r.title}</a></h2>
              <p>{r.content_plain}</p>
            </div>
            {i < (chunks.results as any[]).length - 1 && (
              <div class="diff-connector" aria-hidden="true" />
            )}
          </article>
        ))}
      </div>
    </Layout>
  );
});

// Feature 6: RSS feed per tag
tags.get("/:slug/feed.xml", async (c) => {
  const slug = c.req.param("slug");
  const tag = await c.env.DB.prepare("SELECT * FROM tags WHERE slug = ?")
    .bind(slug)
    .first<TagRow>();

  if (!tag) return c.notFound();

  const chunks = await c.env.DB.prepare(
    `SELECT c.*, e.slug as episode_slug, e.published_date
     FROM chunks c
     JOIN chunk_tags ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.tag_id = ?
     ORDER BY e.published_date DESC
     LIMIT 50`
  )
    .bind(tag.id)
    .all();

  const baseUrl = getBaseUrl(c.req.url);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Bobbin — Tag: ${escapeXml(tag.name)}</title>
  <link href="${baseUrl}/tags/${escapeXml(tag.slug)}" />
  <link href="${baseUrl}/tags/${escapeXml(tag.slug)}/feed.xml" rel="self" />
  <id>${baseUrl}/tags/${escapeXml(tag.slug)}</id>
  <updated>${new Date().toISOString()}</updated>
  <author><name>Alex Komoroske</name></author>
${(chunks.results as any[])
  .map(
    (r) => `  <entry>
    <title>${escapeXml(r.title)}</title>
    <link href="${baseUrl}/chunks/${escapeXml(r.slug)}" />
    <id>${baseUrl}/chunks/${escapeXml(r.slug)}</id>
    <published>${r.published_date}T00:00:00Z</published>
    <summary>${escapeXml(r.content_plain.substring(0, 300))}</summary>
  </entry>`
  )
  .join("\n")}
</feed>`;

  return c.body(xml, {
    headers: { "Content-Type": "application/atom+xml" },
  });
});

export { tags as tagRoutes };
