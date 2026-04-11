import type { FC } from "hono/jsx";
import type { TagRow } from "../types";

export const TagCloud: FC<{ tags: TagRow[] }> = ({ tags }) => {
  const maxCount = Math.max(...tags.map((t) => t.usage_count), 1);
  const minSize = 0.7;
  const maxSize = 1.15;

  return (
    <div class="tag-cloud">
      {tags.map((tag) => {
        const scale = minSize + (tag.usage_count / maxCount) * (maxSize - minSize);
        return (
          <a
            key={tag.id}
            href={`/tags/${tag.slug}`}
            class="tag"
            style={`font-size:${scale.toFixed(2)}rem`}
          >
            {tag.name}
          </a>
        );
      })}
    </div>
  );
};
