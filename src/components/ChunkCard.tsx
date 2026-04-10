import type { FC } from "hono/jsx";
import type { ChunkRow } from "../types";

interface ChunkCardProps {
  chunk: ChunkRow;
  episodeSlug?: string;
  episodeTitle?: string;
  showEpisodeLink?: boolean;
  query?: string;
}

function getExcerpt(text: string, query?: string, maxLen = 200): string {
  if (!text) return "";
  if (!query) return text.substring(0, maxLen) + (text.length > maxLen ? "..." : "");

  // Find the query in the text and show context around it
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);

  if (idx === -1) return text.substring(0, maxLen) + (text.length > maxLen ? "..." : "");

  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + query.length + 100);
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = "..." + excerpt;
  if (end < text.length) excerpt = excerpt + "...";
  return excerpt;
}

export const ChunkCard: FC<ChunkCardProps> = ({
  chunk,
  episodeSlug,
  episodeTitle,
  showEpisodeLink = false,
  query,
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
    <p class="excerpt">
      {getExcerpt(chunk.content_plain || chunk.summary || "", query)}
    </p>
  </article>
);
