import type { FC } from "hono/jsx";
import type { EpisodeRow } from "../types";

export const EpisodeCard: FC<{ episode: EpisodeRow }> = ({ episode }) => (
  <article class="episode-card">
    <h2>
      <a href={`/episodes/${episode.slug}`}>{episode.title}</a>
    </h2>
    <time datetime={episode.published_date}>
      {new Date(episode.published_date + "T00:00:00Z").toLocaleDateString(
        "en-US",
        { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
      )}
    </time>
    <span class="chunk-count">{episode.chunk_count} observations</span>
  </article>
);
