import type { Child } from "hono/jsx";

type TopicLink = {
  id?: number | string;
  name: string;
  slug: string;
};

export function TopicRailList(props: {
  title: string;
  topics: TopicLink[];
  help?: Child;
  sectionClassName?: string;
  listClassName?: string;
}) {
  const sectionClass = [props.sectionClassName, "rail-panel"].filter(Boolean).join(" ");
  const listClass = ["rail-panel-list", props.listClassName].filter(Boolean).join(" ");

  return (
    <section class={sectionClass}>
      <div class="rail-panel-heading-row">
        <h3>{props.title}</h3>
        {props.help}
      </div>
      <div class={listClass}>
        <ul>
          {props.topics.map((topic, index) => (
            <li key={topic.id ?? `${topic.slug}-${index}`}>
              <a href={`/topics/${topic.slug}`}>{topic.name}</a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
