import type { Child } from "hono/jsx";

export function TopicChartPanel(props: {
  title: string;
  chart: Child;
  help?: Child;
  meta?: Child;
  metaPosition?: "before" | "after";
  variant?: "section" | "rail";
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const variant = props.variant || "section";
  const metaPosition = props.metaPosition || "after";
  const sectionClass = [props.className, variant === "rail" ? "rail-panel rail-chart-panel" : null].filter(Boolean).join(" ");

  return (
    <section class={sectionClass} id={props.id} aria-label={props.ariaLabel}>
      {variant === "rail" ? (
        <div class="rail-panel-heading-row">
          <h3>{props.title}</h3>
          {props.help}
        </div>
      ) : (
        <div class="section-heading-row">
          <h2 class="section-heading">{props.title}</h2>
          {props.help}
        </div>
      )}
      {metaPosition === "before" ? props.meta : null}
      {props.chart}
      {metaPosition === "after" ? props.meta : null}
    </section>
  );
}
