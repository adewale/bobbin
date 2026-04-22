import { Hono } from "hono";
import type { AppEnv } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { RichContent, RichFootnotes, parseFootnotesJson, parseRichContentJson } from "../components/RichContent";
import { getCrossReferences } from "../services/cross-refs";
import { safeJsonForHtml } from "../lib/html";
import { getChunkBySlug, getChunkTopics, getRelatedByTopics, getThreadChunks, getAdjacentChunks } from "../db/chunks";
import { getEpisodeTopicsBlended } from "../db/episodes";

const chunks = new Hono<AppEnv>();

chunks.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const chunk = await getChunkBySlug(c.env.DB, slug);
  if (!chunk) return c.notFound();

  const isNotes = chunk.episode_format === "notes";

  const [topics, thread, adjacentResult, episodeBlend] = await Promise.all([
    getChunkTopics(c.env.DB, chunk.id),
    getThreadChunks(c.env.DB, chunk.id, chunk.episode_id),
    getAdjacentChunks(c.env.DB, chunk.episode_id, chunk.position),
    getEpisodeTopicsBlended(c.env.DB, chunk.episode_id, 0, 3),
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
  const richBlocks = parseRichContentJson(chunk.rich_content_json);
  const footnotes = parseFootnotesJson((chunk as any).footnotes_json ?? null);
  const paragraphs = chunk.content.split("\n").filter((line, i) => {
    if (i === 0 && line.trim() === chunk.title.trim()) return false;
    return line.trim();
  });

  return c.html(
    <Layout
      title={chunk.title}
      description={chunk.content_plain.substring(0, 160)}
      activePath="/episodes"
      mainClassName="main-wide"
    >
      <div class={(topics.length > 0 || episodeBlend.distinctive.length > 0) ? `page-with-rail page-with-rail--aligned ${isNotes ? "chunk-compact" : "tufte-layout"}` : (isNotes ? "chunk-compact" : "tufte-layout")}>
        <div class="page-body chunk-detail-column">
          <article class="chunk-detail">
            <div class="page-preamble">
              <Breadcrumbs
                crumbs={[
                  { label: "Episodes", href: "/episodes" },
                  { label: chunk.episode_title, href: `/episodes/${chunk.episode_slug}` },
                  { label: chunk.title },
                ]}
              />
            </div>

            <h1>{chunk.title}</h1>
            <div class="chunk-meta">
              <time datetime={chunk.published_date}>{chunk.published_date}</time>
              <span> &middot; </span>
              <a href={`/episodes/${chunk.episode_slug}`}>
                {chunk.episode_title}
              </a>
            </div>

            <div class="chunk-content">
              {richBlocks.length > 0 ? (
                <>
                  <RichContent blocks={richBlocks} />
                  <RichFootnotes footnotes={footnotes} />
                </>
              ) : paragraphs.map((para, i) => (
                <p key={i}>{para}</p>
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

          {(prevChunk || nextChunk) && (
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

        {(topics.length > 0 || episodeBlend.distinctive.length > 0) && (
          <aside class="page-rail topics-margin">
            {topics.length > 0 && (
              <div class="topic-tier-main">
                <h3>Topics</h3>
                <div class="topics">
                  {topics.map((topic) => (
                    <a key={topic.id} href={`/topics/${topic.slug}`} class="topic">
                      {topic.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {episodeBlend.distinctive.length > 0 && (
              <div class="distinctive-topics">
                <h4>Distinctive this episode</h4>
                <div class="topics">
                  {episodeBlend.distinctive.map((topic) => (
                    <a key={topic.id} href={`/topics/${topic.slug}`} class="topic topic-distinctive">
                      {topic.name}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {relatedItems.length > 0 && (
              <div class="related-inline-list">
                <h4>Related</h4>
                <ul>
                  {relatedItems.slice(0, 4).filter((r: any) => r.slug).map((r: any) => (
                    <li key={r.id}>
                      <a href={`/chunks/${r.slug}`}>{r.title}</a>
                      <time>{r.rel_date}</time>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}

      </div>
    </Layout>
  );
});

export { chunks as chunkRoutes };
