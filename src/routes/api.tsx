import { Hono } from "hono";
import type { AppEnv } from "../types";
import { fetchGoogleDocHtml } from "../services/google-docs";
import { parseHtmlDocument, extractDocLinksFromHtml } from "../services/html-parser";
import { ingestParsedEpisodes } from "../jobs/ingest";
import { ftsSearch } from "../services/search";

const api = new Hono<AppEnv>();

api.get("/search", async (c) => {
  const query = c.req.query("q")?.trim() || "";

  if (!query) {
    return c.json({ results: [], query: "" });
  }

  let results;
  try {
    results = await ftsSearch(c.env.DB, query);
  } catch {
    // FTS not available, fall back
    const kwResults = await c.env.DB.prepare(
      `SELECT c.id, c.slug, c.title, c.summary, c.content_plain,
              e.slug as episode_slug, e.title as episode_title, e.published_date
       FROM chunks c JOIN episodes e ON c.episode_id = e.id
       WHERE c.content_plain LIKE ?
       ORDER BY e.published_date DESC LIMIT 20`
    )
      .bind(`%${query}%`)
      .all();
    results = kwResults.results;
  }

  return c.json({
    results,
    query,
    count: results.length,
  });
});

// Ingest a single source doc, limited to `limit` episodes per call.
// Call repeatedly until all episodes are ingested.
api.get("/ingest", async (c) => {
  const limit = parseInt(c.req.query("limit") || "3", 10);
  const docId = c.req.query("doc") || "";

  try {
    // Ensure sources exist
    const sources = await c.env.DB.prepare("SELECT * FROM sources").all();
    if (!sources.results.length) {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT OR IGNORE INTO sources (google_doc_id, title) VALUES ('1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA', 'Bits and Bobs (Current)')"),
        c.env.DB.prepare("INSERT OR IGNORE INTO sources (google_doc_id, title, is_archive) VALUES ('1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0', 'Bits and Bobs (Archive 1)', 1)"),
        c.env.DB.prepare("INSERT OR IGNORE INTO sources (google_doc_id, title, is_archive) VALUES ('1GrEFrdF_IzRVXbGH1lG0aQMlvsB71XihPPqQN-ONTuo', 'Bits and Bobs (Archive 2)', 1)"),
      ]);
    }

    // Pick which source to ingest
    let source: any;
    if (docId) {
      source = await c.env.DB.prepare("SELECT * FROM sources WHERE google_doc_id = ?").bind(docId).first();
    } else {
      // Pick the source that was fetched least recently (or never)
      source = await c.env.DB.prepare(
        "SELECT * FROM sources ORDER BY last_fetched_at IS NOT NULL, last_fetched_at ASC LIMIT 1"
      ).first();
    }

    if (!source) {
      return c.json({ error: "No source found" }, 404);
    }

    // Fetch and parse
    const html = await fetchGoogleDocHtml(source.google_doc_id);
    const allEpisodes = parseHtmlDocument(html);

    // Only ingest `limit` new episodes per call
    const existing = await c.env.DB.prepare(
      "SELECT published_date FROM episodes WHERE source_id = ?"
    ).bind(source.id).all();
    const existingDates = new Set((existing.results as any[]).map((r) => r.published_date));

    const newEpisodes = allEpisodes.filter((ep) => {
      const dateStr = ep.parsedDate.toISOString().split("T")[0];
      return !existingDates.has(dateStr);
    });

    const batch = newEpisodes.slice(0, limit);
    const result = await ingestParsedEpisodes(c.env, source.id, batch);

    // Discover archive links
    const newDocIds = extractDocLinksFromHtml(html);
    for (const id of newDocIds) {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO sources (google_doc_id, title, is_archive) VALUES (?, ?, 1)"
      ).bind(id, `Archive (${id.substring(0, 8)}...)`).run();
    }

    await c.env.DB.prepare(
      "UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?"
    ).bind(source.id).run();

    return c.json({
      status: "ok",
      source: source.title,
      episodesIngested: result.episodesAdded,
      chunksIngested: result.chunksAdded,
      remaining: newEpisodes.length - batch.length,
      totalInDoc: allEpisodes.length,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Reactive API: concordance with date filtering
api.get("/concordance", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = parseInt(c.req.query("limit") || "200", 10);

  let query: string;
  let binds: any[];

  if (from || to) {
    query = `SELECT cw.word, SUM(cw.count) as total_count, COUNT(DISTINCT cw.chunk_id) as doc_count
       FROM chunk_words cw
       JOIN chunks c ON cw.chunk_id = c.id
       JOIN episodes e ON c.episode_id = e.id
       WHERE 1=1
       ${from ? "AND e.published_date >= ?" : ""}
       ${to ? "AND e.published_date <= ?" : ""}
       GROUP BY cw.word
       ORDER BY total_count DESC
       LIMIT ?`;
    binds = [...(from ? [from] : []), ...(to ? [to] : []), limit];
  } else {
    query = `SELECT word, total_count, doc_count FROM concordance ORDER BY total_count DESC LIMIT ?`;
    binds = [limit];
  }

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  return c.json({ words: results.results });
});

// Reactive API: timeline data
api.get("/timeline", async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT year, month, COUNT(*) as count, SUM(chunk_count) as total_chunks
     FROM episodes
     GROUP BY year, month
     ORDER BY year, month`
  ).all();

  return c.json({ months: results.results });
});

export { api as apiRoutes };
