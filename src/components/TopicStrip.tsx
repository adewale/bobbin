type TopicLink = {
  id?: number | string;
  name: string;
  slug: string;
};

export function TopicStrip(props: {
  topics: TopicLink[];
  variant?: "chips" | "inline";
  className?: string;
  linkClassName?: string;
}) {
  const variant = props.variant || "chips";

  if (variant === "inline") {
    return (
      <span class={props.className}>
        {props.topics.map((topic, index) => (
          <span key={topic.id ?? `${topic.slug}-${index}`}>
            {index > 0 ? " · " : ""}
            <a href={`/topics/${topic.slug}`} class={props.linkClassName}>{topic.name}</a>
          </span>
        ))}
      </span>
    );
  }

  return (
    <div class={props.className || "topics"}>
      {props.topics.map((topic, index) => (
        <a key={topic.id ?? `${topic.slug}-${index}`} href={`/topics/${topic.slug}`} class={props.linkClassName || "topic"}>{topic.name}</a>
      ))}
    </div>
  );
}
