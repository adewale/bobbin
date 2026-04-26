import type { Child } from "hono/jsx";

export type TopicListItem = {
  id?: number | string;
  name: string;
  slug: string;
  count?: number | string;
  trend?: "up" | "down";
  salient?: boolean;
};

type TopicListLayout = "run" | "stack" | "multiples";

type TopicListProps = {
  topics: TopicListItem[];
  layout?: TopicListLayout;
  className?: string;
  ariaLabel?: string;
  spark?: (topic: TopicListItem) => Child;
};

const TREND_GLYPH = { up: "↑", down: "↓" } as const;

function topicKey(topic: TopicListItem, index: number): string | number {
  return topic.id ?? `${topic.slug}-${index}`;
}

function anchorClass(topic: TopicListItem): string | undefined {
  return topic.salient ? "is-salient" : undefined;
}

function trendNode(topic: TopicListItem): Child {
  if (!topic.trend) return null;
  const glyph = TREND_GLYPH[topic.trend];
  const label = topic.trend === "up" ? "trending up" : "trending down";
  return (
    <span class="topic-trend" aria-label={label}>{glyph}</span>
  );
}

function countNode(topic: TopicListItem): Child {
  if (topic.count === undefined || topic.count === null || topic.count === "") return null;
  return <span class="topic-count">{topic.count}</span>;
}

export function TopicList(props: TopicListProps) {
  const layout: TopicListLayout = props.layout ?? "run";

  if (layout === "run") {
    const className = ["topic-run", props.className].filter(Boolean).join(" ");
    return (
      <span class={className} aria-label={props.ariaLabel}>
        {props.topics.map((topic, index) => (
          <span key={topicKey(topic, index)}>
            {index > 0 ? <span class="topic-run-sep" aria-hidden="true">·</span> : null}
            <a href={`/topics/${topic.slug}`} class={anchorClass(topic)}>
              {topic.name}
              {trendNode(topic)}
            </a>
            {countNode(topic)}
          </span>
        ))}
      </span>
    );
  }

  if (layout === "stack") {
    const className = ["topic-stack", props.className].filter(Boolean).join(" ");
    return (
      <ul class={className} aria-label={props.ariaLabel}>
        {props.topics.map((topic, index) => (
          <li key={topicKey(topic, index)}>
            <a href={`/topics/${topic.slug}`} class={anchorClass(topic)}>
              {topic.name}
              {trendNode(topic)}
            </a>
            {countNode(topic)}
          </li>
        ))}
      </ul>
    );
  }

  const className = ["topic-multiples", props.className].filter(Boolean).join(" ");
  return (
    <div class={className} aria-label={props.ariaLabel}>
      <div class="multiples-grid">
        {props.topics.map((topic, index) => (
          <a
            key={topicKey(topic, index)}
            href={`/topics/${topic.slug}`}
            class="multiple-cell"
            title={topic.count !== undefined ? `${topic.name} — ${topic.count}` : topic.name}
          >
            <span class="multiple-name">{topic.name}</span>
            {topic.count !== undefined ? <span class="multiple-count">{topic.count}</span> : null}
            {props.spark ? props.spark(topic) : null}
          </a>
        ))}
      </div>
    </div>
  );
}
