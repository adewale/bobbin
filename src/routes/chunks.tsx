import { Hono } from "hono";
import type { AppEnv, ChunkRow, TagRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { getCrossReferences } from "../services/cross-refs";
import { safeJsonForHtml } from "../lib/html";

const chunks = new Hono<AppEnv>();

chunks.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const chunk = await c.env.DB.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date, e.format as episode_format
     FROM chunks c
     JOIN episodes e ON c.episode_id = e.id
     WHERE c.slug = ?`
  )
    .bind(slug)
    .first();

  if (!chunk) return c.notFound();

  const tags = await c.env.DB.prepare(
    `SELECT t.* FROM tags t
     JOIN chunk_tags ct ON t.id = ct.tag_id
     WHERE ct.chunk_id = ?
     ORDER BY t.usage_count DESC`
  )
    .bind((chunk as any).id)
    .all();

  // Try Vectorize cross-references first, fall back to tag-based
  let relatedItems: any[] = [];
  try {
    if (c.env.VECTORIZE && (chunk as any).vector_id) {
      const crossRefs = await getCrossReferences(
        c.env.VECTORIZE, c.env.DB,
        (chunk as any).vector_id, (chunk as any).id
      );
      relatedItems = crossRefs.map((r) => ({
        id: r.chunkId, slug: r.slug, title: r.title,
        episode_slug: r.episodeSlug, rel_date: r.publishedDate,
        score: r.score,
      }));
    }
  } catch (e) {
    console.error("Cross-ref lookup failed:", e);
  }

  if (!relatedItems.length) {
    const related = await c.env.DB.prepare(
      `SELECT DISTINCT c.*, e.slug as episode_slug, e.published_date as rel_date
       FROM chunks c
       JOIN chunk_tags ct1 ON c.id = ct1.chunk_id
       JOIN chunk_tags ct2 ON ct1.tag_id = ct2.tag_id
       JOIN episodes e ON c.episode_id = e.id
       WHERE ct2.chunk_id = ? AND c.id != ?
       LIMIT 5`
    )
      .bind((chunk as any).id, (chunk as any).id)
      .all();
    relatedItems = related.results as any[];
  }

  // Fix 5: "More on this topic" — chunks from OTHER episodes that share tags
  const thread = await c.env.DB.prepare(
    `SELECT DISTINCT c.id, c.slug, c.title, c.content_plain,
            e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_tags ct1 ON c.id = ct1.chunk_id
     JOIN chunk_tags ct2 ON ct1.tag_id = ct2.tag_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct2.chunk_id = ? AND c.id != ? AND c.episode_id != ?
     ORDER BY e.published_date DESC
     LIMIT 8`
  )
    .bind((chunk as any).id, (chunk as any).id, (chunk as any).episode_id)
    .all();

  const chunkData = chunk as any;
  const isNotes = chunkData.episode_format === "notes";
  const paragraphs = chunkData.content.split("\n").filter((p: string) => p.trim());

  // Prev/next navigation for notes-format chunks
  let prevChunk: any = null;
  let nextChunk: any = null;
  if (isNotes) {
    const [prev, next] = await Promise.all([
      c.env.DB.prepare(
        "SELECT slug, title FROM chunks WHERE episode_id = ? AND position = ?"
      ).bind(chunkData.episode_id, chunkData.position - 1).first(),
      c.env.DB.prepare(
        "SELECT slug, title FROM chunks WHERE episode_id = ? AND position = ?"
      ).bind(chunkData.episode_id, chunkData.position + 1).first(),
    ]);
    prevChunk = prev;
    nextChunk = next;
  }

  return c.html(
    <Layout
      title={chunkData.title}
      description={chunkData.content_plain.substring(0, 160)}
      activePath="/episodes"
    >
      <Breadcrumbs
        crumbs={[
          { label: "Episodes", href: "/episodes" },
          { label: chunkData.episode_title, href: `/episodes/${chunkData.episode_slug}` },
          { label: chunkData.title },
        ]}
      />
      <div class={isNotes ? "chunk-compact" : "tufte-layout"}>
        <article class="chunk-detail">
          <h1>{chunkData.title}</h1>
          <div class="chunk-meta">
            <time datetime={chunkData.published_date}>
              {new Date(chunkData.published_date + "T00:00:00Z").toLocaleDateString(
                "en-US",
                { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
              )}
            </time>
            <span> &middot; </span>
            <a href={`/episodes/${chunkData.episode_slug}`}>
              {chunkData.episode_title}
            </a>
          </div>

          {(tags.results as unknown as TagRow[]).length > 0 && (
            <aside class="tags-margin">
              <details>
                <summary>Tags</summary>
                <div class="tags">
                  {(tags.results as unknown as TagRow[]).map((tag) => (
                    <a key={tag.id} href={`/tags/${tag.slug}`} class="tag">
                      {tag.name}
                    </a>
                  ))}
                </div>
              </details>
            </aside>
          )}

          <div class="chunk-content">
            {paragraphs.map((para: string, i: number) => (
              <div key={i} class="para-with-margin">
                <p>{para}</p>
                {relatedItems[i] && relatedItems[i].slug && (
                  <aside class="margin-note">
                    <a href={`/chunks/${relatedItems[i].slug}`}>
                      {relatedItems[i].title}
                    </a>
                    <time>{relatedItems[i].rel_date}</time>
                  </aside>
                )}
              </div>
            ))}
            {/* Remaining margin notes after paragraphs run out */}
            {relatedItems.slice(paragraphs.length).map((r: any) => (
              <aside key={r.id} class="margin-note margin-note-trailing">
                <a href={`/chunks/${r.slug}`}>{r.title}</a>
                <time>{r.rel_date}</time>
              </aside>
            ))}
          </div>

          {!isNotes && (
            <button class="reading-mode" onclick="document.body.classList.toggle('reader')">
              Reading mode
            </button>
          )}

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonForHtml({
                "@context": "https://schema.org",
                "@type": "Article",
                headline: chunkData.title,
                author: { "@type": "Person", name: "Alex Komoroske" },
                datePublished: chunkData.published_date,
                description: chunkData.content_plain.substring(0, 160),
                isPartOf: { "@type": "Periodical", name: "Bits and Bobs" },
              }),
            }}
          />
        </article>

        {(thread.results as any[]).length > 0 && (
          <section class="more-on-this">
            <h2>More on this topic</h2>
            <p class="section-subtitle">From other episodes</p>
            <ul>
              {(thread.results as any[]).map((r: any) => (
                <li key={r.id}>
                  <a href={`/chunks/${r.slug}`}>{r.title}</a>
                  <span class="meta">
                    <a href={`/episodes/${r.episode_slug}`}>{r.published_date}</a>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {isNotes && (prevChunk || nextChunk) && (
          <nav class="chunk-nav">
            {prevChunk && (
              <a href={`/chunks/${prevChunk.slug}`} class="nav-prev">
                &larr; {prevChunk.title}
              </a>
            )}
            {nextChunk && (
              <a href={`/chunks/${nextChunk.slug}`} class="nav-next">
                {nextChunk.title} &rarr;
              </a>
            )}
          </nav>
        )}
      </div>
    </Layout>
  );
});

export { chunks as chunkRoutes };
