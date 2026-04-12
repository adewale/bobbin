import type { FC } from "hono/jsx";
import type { TopicRow } from "../types";

export const TopicCloud: FC<{ topics: TopicRow[] }> = ({ topics }) => {
  const maxCount = Math.max(...topics.map((t) => t.usage_count), 1);
  const minSize = 0.7;
  const maxSize = 1.15;

  return (
    <div class="topic-cloud">
      {topics.map((topic) => {
        const scale = minSize + (topic.usage_count / maxCount) * (maxSize - minSize);
        return (
          <a
            key={topic.id}
            href={`/topics/${topic.slug}`}
            class="topic"
            style={`font-size:${scale.toFixed(2)}rem`}
          >
            {topic.name}
          </a>
        );
      })}
    </div>
  );
};
