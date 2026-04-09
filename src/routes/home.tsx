import { Hono } from "hono";
import type { AppEnv, EpisodeRow, TagRow } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { TagCloud } from "../components/TagCloud";
import { SearchForm } from "../components/SearchForm";

const home = new Hono<AppEnv>();

home.get("/", async (c) => {
  const episodes = await c.env.DB.prepare(
    "SELECT * FROM episodes ORDER BY published_date DESC LIMIT 10"
  ).all();

  const tags = await c.env.DB.prepare(
    "SELECT * FROM tags WHERE usage_count > 0 ORDER BY usage_count DESC LIMIT 30"
  ).all();

  return c.html(
    <Layout
      title="Home"
      description="An archive of Alex Komoroske's Bits and Bobs weekly newsletter"
    >
      <section class="hero">
        <h1>Bobbin</h1>
        <p>
          A searchable archive of Alex Komoroske's{" "}
          <em>Bits and Bobs</em> weekly observations.
        </p>
        <SearchForm />
      </section>

      <section class="recent-episodes">
        <h2>Recent Episodes</h2>
        {(episodes.results as unknown as EpisodeRow[]).map((ep) => (
          <EpisodeCard key={ep.id} episode={ep} />
        ))}
        {episodes.results.length > 0 && (
          <a href="/episodes" class="see-all">See all episodes &rarr;</a>
        )}
        {episodes.results.length === 0 && (
          <p>No episodes yet. Content will be ingested soon.</p>
        )}
      </section>

      {(tags.results as unknown as TagRow[]).length > 0 && (
        <section class="tag-section">
          <h2>Popular Tags</h2>
          <TagCloud tags={tags.results as unknown as TagRow[]} />
        </section>
      )}
    </Layout>
  );
});

export { home as homeRoutes };
