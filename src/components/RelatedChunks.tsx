import type { FC } from "hono/jsx";
import type { ChunkRow } from "../types";

interface RelatedItem {
  chunk: ChunkRow;
  episodeSlug: string;
}

export const RelatedChunks: FC<{ items: RelatedItem[] }> = ({ items }) => {
  if (!items.length) return null;

  return (
    <aside class="related-chunks">
      <h3>Related</h3>
      <ul>
        {items.map((item) => (
          <li key={item.chunk.id}>
            <a href={`/chunks/${item.chunk.slug}`}>{item.chunk.title}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
};
