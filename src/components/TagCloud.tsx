import type { FC } from "hono/jsx";
import type { TagRow } from "../types";

export const TagCloud: FC<{ tags: TagRow[] }> = ({ tags }) => (
  <div class="tag-cloud">
    {tags.map((tag) => (
      <a
        key={tag.id}
        href={`/tags/${tag.slug}`}
        class="tag"
        data-count={tag.usage_count}
      >
        {tag.name}
        <span class="count">({tag.usage_count})</span>
      </a>
    ))}
  </div>
);
