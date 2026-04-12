import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { getCrossReferences } from "../services/cross-refs";
import { safeJsonForHtml } from "../lib/html";
import { getChunkBySlug, getChunkTopics, getRelatedByTopics, getThreadChunks, getAdjacentChunks } from "../db/chunks";

const chunks = new Hono<AppEnv>();

chunks.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const chunk = await getChunkBySlug(c.env.DB, slug);
  if (!chunk) return c.notFound();

  const isNotes = chunk.episode_format === "notes";

  const [topics, thread, adjacentResult] = await Promise.all([
    getChunkTopics(c.env.DB, chunk.id),
    getThreadChunks(c.env.DB, chunk.id, chunk.episode_id),
    isNotes ? getAdjacentChunks(c.env.DB, chunk.episode_id, chunk.position) : Promise.resolve({ prev: null, next: null }),
  ]);

  // Cross-refs still sequential since they have a fallback
  let relatedItems: any[] = [];
  try {
    if (c.env.VECTORIZE && chunk.vector_id) {
      const crossRefs = await getCrossReferences(c.env.VECTORIZE, c.env.DB, chunk.vector_id, chunk.id);
      relatedItems = crossRefs.map((r) => ({
        id: r.chunkId, slug: r.slug, title: r.title,
        episode_slug: r.episodeSlug, rel_date: r.publishedDate,
      }));
    }
  } catch (e) {
    console.error("Cross-ref lookup failed:", e);
  }
  if (!relatedItems.length) {
    relatedItems = await getRelatedByTopics(c.env.DB, chunk.id);
  }

  const prevChunk = adjacentResult.prev;
  const nextChunk = adjacentResult.next;
  const paragraphs = chunk.content.split("\n").filter((line, i) => {
    if (i === 0 && line.trim() === chunk.title.trim()) return false;
    return line.trim();
  });

  return c.html(
    <Layout
      title={chunk.title}
      description={chunk.content_plain.substring(0, 160)}
      activePath="/episodes"
    >
      <Breadcrumbs
        crumbs={[
          { label: "Episodes", href: "/episodes" },
          { label: chunk.episode_title, href: `/episodes/${chunk.episode_slug}` },
          { label: chunk.title },
        ]}
      />
      <div class={isNotes ? "chunk-compact" : "tufte-layout"}>
        <article class="chunk-detail">
          <h1>{chunk.title}</h1>
          <div class="chunk-meta">
            <time datetime={chunk.published_date}>{chunk.published_date}</time>
            <span> &middot; </span>
            <a href={`/episodes/${chunk.episode_slug}`}>
              {chunk.episode_title}
            </a>
          </div>

          {topics.length > 0 && (
            <aside class="topics-margin">
              <details>
                <summary>Topics</summary>
                <div class="topics">
                  {topics.map((topic) => (
                    <a key={topic.id} href={`/topics/${topic.slug}`} class="topic">
                      {topic.name}
                    </a>
                  ))}
                </div>
              </details>
            </aside>
          )}

          <div class="chunk-content">
            {paragraphs.map((para, i) => (
              <div key={i} class="para-with-margin">
                <p>{para}</p>
                {relatedItems[i]?.slug && (
                  <aside class="margin-note">
                    <a href={`/chunks/${relatedItems[i].slug}`}>
                      {relatedItems[i].title}
                    </a>
                    <time>{relatedItems[i].rel_date}</time>
                  </aside>
                )}
              </div>
            ))}
            {paragraphs.length > 0 && relatedItems.slice(paragraphs.length).filter((r: any) => r.slug).map((r: any) => (
              <aside key={r.id} class="margin-note margin-note-trailing">
                <a href={`/chunks/${r.slug}`}>{r.title}</a>
                <time>{r.rel_date}</time>
              </aside>
            ))}
          </div>

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonForHtml({
                "@context": "https://schema.org",
                "@type": "Article",
                headline: chunk.title,
                author: { "@type": "Person", name: "Alex Komoroske" },
                datePublished: chunk.published_date,
                description: chunk.content_plain.substring(0, 160),
                isPartOf: { "@type": "Periodical", name: "Bits and Bobs" },
              }),
            }}
          />
        </article>

        {(thread as any[]).length > 0 && (
          <section class="more-on-this">
            <h2>More on this topic</h2>
            <p class="section-subtitle">From other episodes</p>
            <ul>
              {(thread as any[]).map((r: any) => (
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
