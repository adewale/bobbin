import { Hono } from "hono";
import type { AppEnv, TagRow, ChunkRow } from "../types";
import { Layout } from "../components/Layout";
import { escapeXml, getBaseUrl } from "../lib/html";
import { SearchForm } from "../components/SearchForm";
import { getFilteredTags, getTagBySlug, getTagChunkCount, getTaggedChunks, getTagSparkline, getTagEpisodes } from "../db/tags";
import { TagCloud } from "../components/TagCloud";
import { ChunkCard } from "../components/ChunkCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Pagination } from "../components/Pagination";

const tags = new Hono<AppEnv>();
const PAGE_SIZE = 20;

tags.get("/", async (c) => {
  // Three tiers: multi-word entities, proper nouns, domain concepts
  const [multiWord, properNouns, conceptResults] = await Promise.all([
    // Multi-word entities: "claude code", "simon willison"
    c.env.DB.prepare(
      "SELECT * FROM tags WHERE usage_count >= 3 AND name LIKE '% %' ORDER BY usage_count DESC LIMIT 20"
    ).all<TagRow>(),
    // Distinctive domain terms: not in baseline, high distinctiveness
    c.env.DB.prepare(
      `SELECT t.* FROM tags t
       JOIN concordance c ON c.word = t.name
       WHERE t.usage_count >= 5 AND t.name NOT LIKE '% %'
         AND c.in_baseline = 0 AND c.distinctiveness >= 10
       ORDER BY c.distinctiveness DESC LIMIT 20`
    ).all<TagRow>(),
    // Domain concepts: ranked by usage × distinctiveness
    c.env.DB.prepare(
      `SELECT t.*, COALESCE(c.distinctiveness, 0) as dist
       FROM tags t
       LEFT JOIN concordance c ON c.word = t.name
       WHERE t.usage_count >= 3 AND t.name NOT LIKE '% %'
       ORDER BY t.usage_count * COALESCE(c.distinctiveness, 1) DESC
       LIMIT 80`
    ).all<TagRow>(),
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

  const tag = await getTagBySlug(c.env.DB, slug);
  if (!tag) return c.notFound();

  const [total, chunksList, episodes, sparkline] = await Promise.all([
    getTagChunkCount(c.env.DB, tag.id),
    getTaggedChunks(c.env.DB, tag.id, PAGE_SIZE, offset),
    getTagEpisodes(c.env.DB, tag.id),
    getTagSparkline(c.env.DB, tag.id),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
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
