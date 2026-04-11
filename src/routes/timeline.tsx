import { Hono } from "hono";
import type { AppEnv, EpisodeRow } from "../types";
import { Layout } from "../components/Layout";
import { EpisodeCard } from "../components/EpisodeCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { monthName } from "../lib/date";

const timeline = new Hono<AppEnv>();

// GET /timeline — list of years
timeline.get("/", async (c) => {
  const years = await c.env.DB.prepare(
    `SELECT year, COUNT(*) as count
     FROM episodes
     GROUP BY year
     ORDER BY year DESC`
  ).all();

  return c.html(
    <Layout title="Timeline" description="Browse Bits and Bobs by date">
      <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Timeline" }]} />
      <h1>Timeline</h1>
      {years.results.length === 0 && <p>No episodes yet.</p>}
      <ul class="timeline-years">
        {(years.results as any[]).map((y) => (
          <li key={y.year}>
            <a href={`/timeline/${y.year}`}>
              {y.year}
            </a>
            <span class="count"> ({y.count} episode{y.count !== 1 ? "s" : ""})</span>
          </li>
        ))}
      </ul>
    </Layout>
  );
});

// GET /timeline/:year — months in a year
timeline.get("/:year", async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  if (isNaN(year)) return c.notFound();

  const months = await c.env.DB.prepare(
    `SELECT month, COUNT(*) as count
     FROM episodes
     WHERE year = ?
     GROUP BY month
     ORDER BY month`
  )
    .bind(year)
    .all();

  return c.html(
    <Layout title={`${year}`} description={`Bits and Bobs episodes from ${year}`}>
      <Breadcrumbs
        crumbs={[
                    { label: "Timeline", href: "/timeline" },
          { label: String(year) },
        ]}
      />
      <h1>{year}</h1>
      {months.results.length === 0 && <p>No episodes in {year}.</p>}
      <ul class="timeline-months">
        {(months.results as any[]).map((m) => (
          <li key={m.month}>
            <a href={`/timeline/${year}/${String(m.month).padStart(2, "0")}`}>
              {monthName(m.month)}
            </a>
            <span class="count"> ({m.count})</span>
          </li>
        ))}
      </ul>
    </Layout>
  );
});

// GET /timeline/:year/:month — episodes in a month
timeline.get("/:year/:month", async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  const month = parseInt(c.req.param("month"), 10);
  if (isNaN(year) || isNaN(month)) return c.notFound();

  const episodes = await c.env.DB.prepare(
    `SELECT * FROM episodes
     WHERE year = ? AND month = ?
     ORDER BY published_date DESC`
  )
    .bind(year, month)
    .all();

  return c.html(
    <Layout
      title={`${monthName(month)} ${year}`}
      description={`Bits and Bobs from ${monthName(month)} ${year}`}
    >
      <Breadcrumbs
        crumbs={[
                    { label: "Timeline", href: "/timeline" },
          { label: String(year), href: `/timeline/${year}` },
          { label: monthName(month) },
        ]}
      />
      <h1>{monthName(month)} {year}</h1>
      {episodes.results.length === 0 && <p>No episodes.</p>}
      {(episodes.results as unknown as EpisodeRow[]).map((ep) => (
        <EpisodeCard key={ep.id} episode={ep} />
      ))}
    </Layout>
  );
});

// GET /timeline/:year/:month/:day — specific episode
timeline.get("/:year/:month/:day", async (c) => {
  const year = c.req.param("year");
  const month = c.req.param("month").padStart(2, "0");
  const day = c.req.param("day").padStart(2, "0");
  const slug = `${year}-${month}-${day}`;

  return c.redirect(`/episodes/${slug}`, 301);
});

export { timeline as timelineRoutes };
