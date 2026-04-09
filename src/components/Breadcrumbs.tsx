import type { FC } from "hono/jsx";

interface Crumb {
  label: string;
  href?: string;
}

export const Breadcrumbs: FC<{ crumbs: Crumb[] }> = ({ crumbs }) => (
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <ol>
      {crumbs.map((crumb, i) => (
        <li key={i}>
          {crumb.href ? (
            <a href={crumb.href}>{crumb.label}</a>
          ) : (
            <span aria-current="page">{crumb.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);
