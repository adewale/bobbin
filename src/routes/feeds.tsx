import { Hono } from "hono";
import type { AppEnv } from "../types";

const feeds = new Hono<AppEnv>();

const BASE_URL = "https://bobbin.pages.dev";

feeds.get("/sitemap.xml", async (c) => {
  const [episodes, chunks, tags] = await Promise.all([
    c.env.DB.prepare("SELECT slug, updated_at FROM episodes").all(),
    c.env.DB.prepare("SELECT slug, updated_at FROM chunks").all(),
    c.env.DB.prepare("SELECT slug FROM tags WHERE usage_count > 0").all(),
  ]);

  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: BASE_URL, priority: "1.0" },
    { loc: `${BASE_URL}/episodes`, priority: "0.9" },
    { loc: `${BASE_URL}/tags`, priority: "0.6" },
    { loc: `${BASE_URL}/concordance`, priority: "0.5" },
    { loc: `${BASE_URL}/timeline`, priority: "0.6" },
    ...(episodes.results as any[]).map((e) => ({
      loc: `${BASE_URL}/episodes/${e.slug}`,
      lastmod: e.updated_at,
      priority: "0.8",
    })),
    ...(chunks.results as any[]).map((ch) => ({
      loc: `${BASE_URL}/chunks/${ch.slug}`,
      lastmod: ch.updated_at,
      priority: "0.7",
    })),
    ...(tags.results as any[]).map((t) => ({
      loc: `${BASE_URL}/tags/${t.slug}`,
      priority: "0.5",
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return c.body(xml, {
    headers: { "Content-Type": "application/xml" },
  });
});

feeds.get("/feed.xml", async (c) => {
  const episodes = await c.env.DB.prepare(
    `SELECT e.*, GROUP_CONCAT(c.title, ', ') as chunk_titles
     FROM episodes e
     LEFT JOIN chunks c ON e.id = c.episode_id
     GROUP BY e.id
     ORDER BY e.published_date DESC
     LIMIT 20`
  ).all();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Bobbin — Bits and Bobs Archive</title>
  <link href="${BASE_URL}" />
  <link href="${BASE_URL}/feed.xml" rel="self" />
  <id>${BASE_URL}/</id>
  <updated>${new Date().toISOString()}</updated>
  <author><name>Alex Komoroske</name></author>
${(episodes.results as any[])
  .map(
    (ep) => `  <entry>
    <title>${escapeXml(ep.title)}</title>
    <link href="${BASE_URL}/episodes/${ep.slug}" />
    <id>${BASE_URL}/episodes/${ep.slug}</id>
    <published>${ep.published_date}T00:00:00Z</published>
    <updated>${ep.updated_at || ep.created_at}</updated>
    <summary>${escapeXml(ep.summary || ep.chunk_titles || "")}</summary>
  </entry>`
  )
  .join("\n")}
</feed>`;

  return c.body(xml, {
    headers: { "Content-Type": "application/atom+xml" },
  });
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { feeds as feedRoutes };
