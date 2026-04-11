import { Hono } from "hono";
import type { AppEnv, EpisodeRow, ChunkRow, TagRow } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Pagination } from "../components/Pagination";

const episodes = new Hono<AppEnv>();
const PAGE_SIZE = 20;

episodes.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, episodeResult] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM episodes").first(),
    c.env.DB.prepare(
      "SELECT * FROM episodes ORDER BY published_date DESC LIMIT ? OFFSET ?"
    )
      .bind(PAGE_SIZE, offset)
      .all(),
  ]);

  const total = (countResult as any)?.count || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return c.html(
    <Layout title="All Episodes" description="Browse all Bits and Bobs episodes">
      <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Episodes" }]} />
      <h1>All Episodes</h1>
      <p>{total} episodes</p>
      {(episodeResult.results as unknown as EpisodeRow[]).map((ep) => (
        <EpisodeCard key={ep.id} episode={ep} />
      ))}
      <Pagination currentPage={page} totalPages={totalPages} baseUrl="/episodes" />
    </Layout>
  );
});

episodes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const episode = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE slug = ?"
  )
    .bind(slug)
    .first<EpisodeRow>();

  if (!episode) return c.notFound();

  const chunks = await c.env.DB.prepare(
    "SELECT * FROM chunks WHERE episode_id = ? ORDER BY position"
  )
    .bind(episode.id)
    .all();

  const tags = await c.env.DB.prepare(
    `SELECT t.* FROM tags t
     JOIN episode_tags et ON t.id = et.tag_id
     WHERE et.episode_id = ?
     ORDER BY t.usage_count DESC`
  )
    .bind(episode.id)
    .all();

  return c.html(
    <Layout title={episode.title} description={`Bits and Bobs from ${episode.published_date} — ${episode.chunk_count} observations`}>
      <Breadcrumbs
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Episodes", href: "/episodes" },
          { label: episode.title },
        ]}
      />
      <article class="episode-detail">
        <h1>{episode.title}</h1>
        <time datetime={episode.published_date}>
          {new Date(episode.published_date + "T00:00:00Z").toLocaleDateString(
            "en-US",
            { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
          )}
        </time>
        {(tags.results as unknown as TagRow[]).length > 0 && (
          <div class="tags">
            {(tags.results as unknown as TagRow[]).map((tag) => (
              <a key={tag.id} href={`/tags/${tag.slug}`} class="tag">
                {tag.name}
              </a>
            ))}
          </div>
        )}

        {episode.format === "essays" ? (
          <section class="episode-essays">
            {(chunks.results as unknown as ChunkRow[]).map((chunk) => (
              <article key={chunk.id} class="essay" id={chunk.slug}>
                <h2><a href={`/chunks/${chunk.slug}`}>{chunk.title}</a></h2>
                <div class="essay-content">
                  {chunk.content.split("\n").map((line, i) => (
                    line.trim() ? <p key={i}>{line}</p> : null
                  ))}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <ol class="episode-toc">
            {(chunks.results as unknown as ChunkRow[]).map((chunk) => (
              <li key={chunk.id}>
                <a href={`/chunks/${chunk.slug}`}>{chunk.title}</a>
              </li>
            ))}
          </ol>
        )}
      </article>
    </Layout>
  );
});

export { episodes as episodeRoutes };
