import { Hono } from "hono";
import type { AppEnv, ConcordanceRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";

const concordance = new Hono<AppEnv>();

concordance.get("/", async (c) => {
  const sortBy = c.req.query("sort") || "distinctive";
  const orderCol = sortBy === "count" ? "total_count" : "distinctiveness";

  const words = await c.env.DB.prepare(
    `SELECT * FROM concordance
     WHERE doc_count >= 2 AND total_count >= 3 AND length(word) >= 4
     ORDER BY ${orderCol} DESC
     LIMIT 200`
  ).all();

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
      {words.results.length === 0 && <p>No concordance data yet.</p>}
      <table class="concordance-table">
        <thead>
          <tr>
            <th>Word</th>
            <th>Count</th>
            <th>Chunks</th>
          </tr>
        </thead>
        <tbody>
          {(words.results as any[]).map((w) => (
            <tr key={w.id}>
              <td>
                <a href={`/concordance/${encodeURIComponent(w.word)}`}>
                  {w.word}
                </a>
                {w.in_baseline === 0 && w.distinctiveness > 5 && (
                  <span class="sip-badge" title="Distinctive to this corpus">SIP</span>
                )}
              </td>
              <td>{w.total_count}</td>
              <td>{w.doc_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <script src="/scripts/reactive.js" defer></script>
    </Layout>
  );
});

concordance.get("/:word", async (c) => {
  const word = decodeURIComponent(c.req.param("word")).toLowerCase();

  const wordData = await c.env.DB.prepare(
    "SELECT * FROM concordance WHERE word = ?"
  )
    .bind(word)
    .first<ConcordanceRow>();

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
    )
      .bind(word)
      .all(),
    c.env.DB.prepare(
      `SELECT e.published_date, e.title, SUM(cw.count) as episode_count
       FROM chunk_words cw
       JOIN chunks c ON cw.chunk_id = c.id
       JOIN episodes e ON c.episode_id = e.id
       WHERE cw.word = ?
       GROUP BY e.id
       ORDER BY e.published_date ASC`
    )
      .bind(word)
      .all(),
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

      <div
        class="word-timeline"
        data-timeline={JSON.stringify(timelineData)}
      >
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

export { concordance as concordanceRoutes };
