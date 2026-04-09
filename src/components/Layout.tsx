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
            <li><a href="/timeline">Timeline</a></li>
            <li><a href="/tags">Tags</a></li>
            <li><a href="/concordance">Concordance</a></li>
            <li><a href="/search">Search</a></li>
          </ul>
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <p>
          Bobbin — An archive of Alex Komoroske's{" "}
          <a href="https://komoroske.com/bits-and-bobs">Bits and Bobs</a>
        </p>
      </footer>
    </body>
  </html>
);
