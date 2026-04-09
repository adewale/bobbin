import type { FC } from "hono/jsx";
import type { ChunkRow } from "../types";

interface ChunkCardProps {
  chunk: ChunkRow;
  episodeSlug?: string;
  episodeTitle?: string;
  showEpisodeLink?: boolean;
}

export const ChunkCard: FC<ChunkCardProps> = ({
  chunk,
  episodeSlug,
  episodeTitle,
  showEpisodeLink = false,
}) => (
  <article class="chunk-card">
    <h3>
      <a href={`/chunks/${chunk.slug}`}>{chunk.title}</a>
    </h3>
    {showEpisodeLink && episodeSlug && (
      <span class="episode-link">
        from <a href={`/episodes/${episodeSlug}`}>{episodeTitle}</a>
      </span>
    )}
    {chunk.summary && <p class="summary">{chunk.summary}</p>}
  </article>
);
