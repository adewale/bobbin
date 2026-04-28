import type { Child } from "hono/jsx";

export function BrowseSection(props: { id?: string; title: Child; children: Child }) {
  return (
    <section class="browse-year" id={props.id}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

export function BrowseSubsection(props: { title: string; children: Child }) {
  return (
    <div class="browse-month">
      <h3>{props.title}</h3>
      {props.children}
    </div>
  );
}

export function BrowseRowList(props: { children: Child }) {
  return <ul class="browse-episodes">{props.children}</ul>;
}

export function BrowseRow(props: { href: string; title: string; meta?: Child; metaHref?: string }) {
  return (
    <li>
      <a href={props.href} class="list-row-link">
        <span class="list-row-title">{props.title}</span>
      </a>
      {props.meta
        ? props.metaHref
          ? <a href={props.metaHref} class="list-row-meta list-row-meta-link">{props.meta}</a>
          : <span class="list-row-meta">{props.meta}</span>
        : null}
    </li>
  );
}
