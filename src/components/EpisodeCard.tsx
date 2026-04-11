import type { FC } from "hono/jsx";
import type { EpisodeRow } from "../types";

export const EpisodeCard: FC<{ episode: EpisodeRow }> = ({ episode }) => (
  <article class="episode-card">
    <h2>
      <a href={`/episodes/${episode.slug}`}>{episode.title}</a>
    </h2>
    <time datetime={episode.published_date}>{episode.published_date}</time>
    <span class="chunk-count">{episode.chunk_count} observations</span>
  </article>
);
