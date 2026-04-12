import { Hono } from "hono";
import type { AppEnv } from "../types";
import { escapeXml, getBaseUrl } from "../lib/html";
import { getSitemapData } from "../db/feeds";

const feeds = new Hono<AppEnv>();

feeds.get("/sitemap.xml", async (c) => {
  const baseUrl = getBaseUrl(c.req.url);

  const { episodes, chunks, tags } = await getSitemapData(c.env.DB);

  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: baseUrl, priority: "1.0" },
    { loc: `${baseUrl}/episodes`, priority: "0.9" },
    { loc: `${baseUrl}/tags`, priority: "0.6" },
    { loc: `${baseUrl}/concordance`, priority: "0.5" },
    { loc: `${baseUrl}/timeline`, priority: "0.6" },
    ...episodes.map((e) => ({
      loc: `${baseUrl}/episodes/${escapeXml(e.slug)}`,
      lastmod: e.updated_at,
      priority: "0.8",
    })),
    ...chunks.map((ch) => ({
      loc: `${baseUrl}/chunks/${escapeXml(ch.slug)}`,
      lastmod: ch.updated_at,
      priority: "0.7",
    })),
    ...tags.map((t) => ({
      loc: `${baseUrl}/tags/${escapeXml(t.slug)}`,
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

  return c.body(xml, { headers: { "Content-Type": "application/xml" } });
});

export { feeds as feedRoutes };
