import { Hono } from "hono";
import type { AppEnv, ConcordanceRow } from "../types";
import { Layout } from "../components/Layout";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { getTopConcordance, getConcordanceWord, getWordChunks, getWordTimeline, getSparklineDataForWords } from "../db/concordance";
import { escapeRegex } from "../lib/html";

const concordance = new Hono<AppEnv>();

concordance.get("/", async (c) => {
  const sortBy = (c.req.query("sort") || "distinctive") as "distinctive" | "count";
  const words = await getTopConcordance(c.env.DB, sortBy, 100);
  const maxCount = Math.max(...words.map((w) => w.total_count), 1);
  const maxDist = Math.max(...words.map((w) => w.distinctiveness), 1);

  // Fetch per-episode sparkline data for the top 50 words
  const top30Words = words.slice(0, 30).map((w) => w.word);
  const sparklineData = await getSparklineDataForWords(c.env.DB, top30Words);

  return c.html(
    <Layout title="Concordance" description="Distinctive words in the Bits and Bobs archive" activePath="/concordance">
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

  const [wordChunks, wordTimeline] = await Promise.all([
    getWordChunks(c.env.DB, word),
    getWordTimeline(c.env.DB, word),
  ]);

  const timelineData = wordTimeline.map((r: any) => ({
    date: r.published_date,
    count: r.episode_count,
    title: r.title,
  }));
  const maxCount = Math.max(...timelineData.map((d) => d.count), 1);

  return c.html(
    <Layout
      title={`"${word}" in context`}
      description={`Occurrences of "${word}" across Bits and Bobs`}
      activePath="/concordance"
    >
      <Breadcrumbs
        crumbs={[
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
        {wordChunks.map((r) => (
          <article key={r.id} class="concordance-entry">
            <h2>
              <a href={`/chunks/${r.slug}`}>{r.title}</a>
            </h2>
            <span class="episode-link">
              <a href={`/episodes/${r.episode_slug}`}>{r.episode_title}</a>
              {" "}&middot;{" "}
              <time datetime={r.published_date}>{r.published_date}</time>
            </span>
            <p
              class="excerpt"
              dangerouslySetInnerHTML={{
                __html: highlightInExcerpt(r.content_plain, word),
              }}
            />
            <span class="word-count">{r.word_count_in_chunk}x in this chunk</span>
          </article>
        ))}
      </div>
    </Layout>
  );
});

function highlightInExcerpt(text: string, word: string): string {
  const excerpt = getExcerptAroundWord(text, word);
  const escaped = excerpt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeWord = escapeRegex(word);
  return escaped.replace(new RegExp(`(${safeWord})`, "gi"), "<mark>$1</mark>");
}

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
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(" ");
}

export { concordance as concordanceRoutes };
