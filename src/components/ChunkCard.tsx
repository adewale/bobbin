import type { FC } from "hono/jsx";
import type { ChunkRow } from "../types";
import { escapeRegex } from "../lib/html";

interface ChunkCardProps {
  chunk: ChunkRow;
  episodeSlug?: string;
  episodeTitle?: string;
  showEpisodeLink?: boolean;
  query?: string;
}

function getExcerptHtml(text: string, query?: string, maxLen = 200): string {
  if (!text) return "";

  // Escape HTML entities in the text
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (!query) {
    const cut = escaped.substring(0, maxLen);
    return cut + (escaped.length > maxLen ? "..." : "");
  }

  // Find match position in original text
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);

  if (idx === -1) {
    const cut = escaped.substring(0, maxLen);
    return cut + (escaped.length > maxLen ? "..." : "");
  }

  // Extract context around match
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + query.length + 100);
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = "..." + excerpt;
  if (end < text.length) excerpt += "...";

  // Escape and highlight
  const escapedExcerpt = excerpt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const safeQuery = escapeRegex(query);
  return escapedExcerpt.replace(
    new RegExp(`(${safeQuery})`, "gi"),
    "<mark>$1</mark>"
  );
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
    <p
      class="excerpt"
      dangerouslySetInnerHTML={{
        __html: getExcerptHtml(chunk.content_plain || chunk.summary || "", query),
      }}
    />
  </article>
);
