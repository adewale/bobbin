import { Hono } from "hono";
import type { AppEnv, ChunkRow, TagRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { getCrossReferences } from "../services/cross-refs";

const chunks = new Hono<AppEnv>();

chunks.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const chunk = await c.env.DB.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
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
  } catch {
    // Vectorize not available
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

  const chunkData = chunk as any;
  const paragraphs = chunkData.content.split("\n\n").filter((p: string) => p.trim());

  return c.html(
    <Layout
      title={chunkData.title}
      description={chunkData.summary || chunkData.content_plain.substring(0, 160)}
    >
      <Breadcrumbs
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Episodes", href: "/episodes" },
          { label: chunkData.episode_title, href: `/episodes/${chunkData.episode_slug}` },
          { label: chunkData.title },
        ]}
      />
      <div class="tufte-layout">
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
            <div class="tags">
              {(tags.results as unknown as TagRow[]).map((tag) => (
                <a key={tag.id} href={`/tags/${tag.slug}`} class="tag">
                  {tag.name}
                </a>
              ))}
            </div>
          )}

          <div class="chunk-content">
            {paragraphs.map((para: string, i: number) => (
              <div key={i} class="para-with-margin">
                <p>{para}</p>
                {relatedItems[i] && (
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

          <button class="reading-mode" onclick="document.body.classList.toggle('reader')">
            Reading mode
          </button>

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Article",
                headline: chunkData.title,
                author: { "@type": "Person", name: "Alex Komoroske" },
                datePublished: chunkData.published_date,
                description: chunkData.summary || chunkData.content_plain.substring(0, 160),
                isPartOf: { "@type": "Periodical", name: "Bits and Bobs" },
              }),
            }}
          />
        </article>
      </div>
    </Layout>
  );
});

export { chunks as chunkRoutes };
