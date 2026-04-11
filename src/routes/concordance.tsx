import { Hono } from "hono";
import type { AppEnv, ConcordanceRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { getTopConcordance, getConcordanceWord } from "../db/concordance";

const concordance = new Hono<AppEnv>();

concordance.get("/", async (c) => {
  const sortBy = (c.req.query("sort") || "distinctive") as "distinctive" | "count";
  const words = await getTopConcordance(c.env.DB, sortBy, 100);
  const maxCount = Math.max(...words.map((w) => w.total_count), 1);
  const maxDist = Math.max(...words.map((w) => w.distinctiveness), 1);

  // Fetch per-episode sparkline data for the top 50 words
  const top50Words = words.slice(0, 50).map((w) => w.word);
  const sparklineData = new Map<string, number[]>();

  if (top50Words.length > 0) {
    const placeholders = top50Words.map(() => "?").join(",");
    const timeline = await c.env.DB.prepare(
      `SELECT cw.word, e.published_date, SUM(cw.count) as ep_count
       FROM chunk_words cw
       JOIN chunks c ON cw.chunk_id = c.id
       JOIN episodes e ON c.episode_id = e.id
       WHERE cw.word IN (${placeholders})
       GROUP BY cw.word, e.id
       ORDER BY e.published_date ASC`
    ).bind(...top50Words).all();

    // Get all unique dates for consistent x-axis
    const allDates = [...new Set((timeline.results as any[]).map((r) => r.published_date))].sort();
    const dateIdx = new Map(allDates.map((d, i) => [d, i]));

    for (const word of top50Words) {
      const points = new Array(allDates.length).fill(0);
      for (const r of timeline.results as any[]) {
        if (r.word === word) {
          points[dateIdx.get(r.published_date)!] = r.ep_count;
        }
      }
      sparklineData.set(word, points);
    }
  }

  return c.html(
    <Layout title="Concordance" description="Distinctive words in the Bits and Bobs archive">
      <Breadcrumbs
        crumbs={[{ label: "Home", href: "/" }, { label: "Concordance" }]}
      />
      <h1>Concordance</h1>
      <p>Words that distinguish Komoroske's writing from typical English.</p>
      <nav class="concordance-sort">
        <a href="/concordance?sort=distinctive" class={sortBy === "distinctive" ? "active" : ""}>
          Most distinctive
        </a>
        <a href="/concordance?sort=count" class={sortBy === "count" ? "active" : ""}>
          Most frequent
        </a>
      </nav>

      {words.length === 0 && <p>No concordance data yet.</p>}

      <div class="concordance-legend">
        <span class="legend-item"><span class="legend-bar bar-distinctive" /> Distinctive — rare in general English</span>
        <span class="legend-item"><span class="legend-bar bar-baseline" /> Common — in top 1000 English words</span>
      </div>

      <table class="concordance-bars">
        <thead>
          <tr>
            <th class="col-word">Word</th>
            <th class="col-bar">
              {sortBy === "distinctive" ? "Distinctiveness" : "Frequency"}
            </th>
            <th class="col-num">Count</th>
            <th class="col-num">Chunks</th>
          </tr>
        </thead>
        <tbody>
          {words.map((w) => {
            const barWidth = sortBy === "distinctive"
              ? (w.distinctiveness / maxDist) * 100
              : (w.total_count / maxCount) * 100;
            const isDistinctive = w.in_baseline === 0 && w.distinctiveness > 5;

            return (
              <tr key={w.id} class={isDistinctive ? "distinctive" : ""}>
                <td class="col-word">
                  <a href={`/concordance/${encodeURIComponent(w.word)}`}>
                    {w.word}
                  </a>
                </td>
                <td class="col-bar">
                  <div class="bar-with-spark">
                    <div
                      class={`bar ${isDistinctive ? "bar-distinctive" : "bar-baseline"}`}
                      style={`width:${Math.max(barWidth, 1)}%`}
                    />
                    {sparklineData.has(w.word) && (
                      <svg class="inline-spark" viewBox="0 0 100 40" preserveAspectRatio="none">
                        <polyline
                          points={renderSparkPoints(sparklineData.get(w.word)!, 40)}
                          fill="none"
                          stroke={isDistinctive ? "var(--accent)" : "var(--text-muted)"}
                          stroke-width="1.5"
                        />
                      </svg>
                    )}
                  </div>
                </td>
                <td class="col-num">{w.total_count}</td>
                <td class="col-num">{w.doc_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <script src="/scripts/reactive.js" defer></script>
    </Layout>
  );
});

concordance.get("/:word", async (c) => {
  const word = decodeURIComponent(c.req.param("word")).toLowerCase();
  const wordData = await getConcordanceWord(c.env.DB, word);
  if (!wordData) return c.notFound();

  const [chunks, timeline] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.*, cw.count as word_count_in_chunk,
              e.slug as episode_slug, e.title as episode_title, e.published_date
       FROM chunk_words cw
       JOIN chunks c ON cw.chunk_id = c.id
       JOIN episodes e ON c.episode_id = e.id
       WHERE cw.word = ?
       ORDER BY cw.count DESC, e.published_date DESC
       LIMIT 100`
    ).bind(word).all(),
    c.env.DB.prepare(
      `SELECT e.published_date, e.title, SUM(cw.count) as episode_count
       FROM chunk_words cw
       JOIN chunks c ON cw.chunk_id = c.id
       JOIN episodes e ON c.episode_id = e.id
       WHERE cw.word = ?
       GROUP BY e.id
       ORDER BY e.published_date ASC`
    ).bind(word).all(),
  ]);

  const timelineData = (timeline.results as any[]).map((r) => ({
    date: r.published_date,
    count: r.episode_count,
    title: r.title,
  }));
  const maxCount = Math.max(...timelineData.map((d) => d.count), 1);

  return c.html(
    <Layout
      title={`"${word}" in context`}
      description={`Occurrences of "${word}" across Bits and Bobs`}
    >
      <Breadcrumbs
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Concordance", href: "/concordance" },
          { label: word },
        ]}
      />
      <h1>&ldquo;{word}&rdquo;</h1>
      <p>
        {wordData.total_count} occurrence{wordData.total_count !== 1 ? "s" : ""}{" "}
        across {wordData.doc_count} chunk{wordData.doc_count !== 1 ? "s" : ""}
      </p>

      <div class="word-timeline" data-timeline={JSON.stringify(timelineData)}>
        <h2>Usage over time</h2>
        <div class="sparkline">
          {timelineData.map((d) => (
            <div
              key={d.date}
              class="spark-bar"
              style={`height:${Math.round((d.count / maxCount) * 100)}%`}
              title={`${d.date}: ${d.count}x`}
            >
              <span class="spark-label">{d.date}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="concordance-results">
        {(chunks.results as any[]).map((r) => (
          <article key={r.id} class="concordance-entry">
            <h2>
              <a href={`/chunks/${r.slug}`}>{r.title}</a>
            </h2>
            <span class="episode-link">
              <a href={`/episodes/${r.episode_slug}`}>{r.episode_title}</a>
              {" "}&middot;{" "}
              <time datetime={r.published_date}>{r.published_date}</time>
            </span>
            <p class="excerpt">
              {getExcerptAroundWord(r.content_plain, word)}
            </p>
            <span class="word-count">{r.word_count_in_chunk}x in this chunk</span>
          </article>
        ))}
      </div>
    </Layout>
  );
});

function getExcerptAroundWord(text: string, word: string, maxLen = 300): string {
  const lower = text.toLowerCase();
  const wLower = word.toLowerCase();
  const idx = lower.indexOf(wLower);
  if (idx === -1) return text.substring(0, maxLen);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + word.length + 150);
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = "..." + excerpt;
  if (end < text.length) excerpt += "...";
  return excerpt;
}

function renderSparkPoints(values: number[], height = 40): string {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const pad = 3; // padding top/bottom
  return values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * 100;
      const y = height - pad - (v / max) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export { concordance as concordanceRoutes };
