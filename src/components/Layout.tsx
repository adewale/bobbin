import type { FC, PropsWithChildren } from "hono/jsx";

type LayoutProps = PropsWithChildren<{
  title: string;
  description?: string;
  canonicalUrl?: string;
}>;

export const Layout: FC<LayoutProps> = ({
  title,
  description,
  canonicalUrl,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} | Bobbin</title>
      {description && <meta name="description" content={description} />}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
      <meta property="og:title" content={title} />
      {description && (
        <meta property="og:description" content={description} />
      )}
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary" />
      <link rel="stylesheet" href="/styles/main.css" />
      <link
        rel="alternate"
        type="application/atom+xml"
        href="/feed.xml"
        title="Bobbin RSS Feed"
      />
    </head>
    <body>
      <header>
        <nav>
          <a href="/" class="site-title">Bobbin</a>
          <ul>
            <li><a href="/episodes">Episodes</a></li>
            <li><a href="/tags">Tags</a></li>
            <li><a href="/concordance">Concordance</a></li>
          </ul>
          <a href="/search" class="search-icon" aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </a>
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <p>
          <a href="https://komoroske.com/bits-and-bobs">Bits and Bobs</a> by Alex Komoroske
        </p>
      </footer>
    </body>
  </html>
);
