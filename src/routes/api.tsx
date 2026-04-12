import { Hono } from "hono";
import type { AppEnv } from "../types";
import { fetchGoogleDoc, parseHtmlDocument, ingestParsedEpisodes, enrichChunks, isEnrichmentComplete } from "../crawler";
import { ftsSearch } from "../services/search";
import { parseSearchQuery } from "../lib/query-parser";
import { keywordSearch } from "../db/search";
import { safeParseInt, escapeLike } from "../lib/html";
import { applyTopicBoost } from "../services/search-topics";
import { expandEntityAliases } from "../lib/entity-aliases";
import { KNOWN_ENTITIES } from "../data/known-entities";

const api = new Hono<AppEnv>();

// Auth middleware for admin endpoints (S1)
function requireAuth(c: any): Response | null {
  const auth = c.req.header("Authorization");
  if (!c.env.ADMIN_SECRET || auth !== `Bearer ${c.env.ADMIN_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}

api.get("/search", async (c) => {
  const query = c.req.query("q")?.trim() || "";

  if (!query) {
    return c.json({ results: [], query: "" });
  }

  let results;
  try {
    const parsed = parseSearchQuery(query);

    // Entity alias expansion
    const entityAliases = expandEntityAliases(parsed.text, KNOWN_ENTITIES);
    if (entityAliases.length > 0) {
      const uniqueTerms = new Set([
        parsed.text.toLowerCase(),
        ...entityAliases,
      ]);
      parsed.text = [...uniqueTerms].filter(Boolean).join(" OR ");
    }

    results = await ftsSearch(c.env.DB, parsed);

    // Topic boost
    if (parsed.text) {
      results = await applyTopicBoost(c.env.DB, query.toLowerCase(), results);
    }
  } catch {
    const parsed = parseSearchQuery(query);
    results = await keywordSearch(c.env.DB, parsed);
  }

  return c.json({ results, query, count: results.length });
});

// Admin: ingest episodes (S1 auth, B3 safe parseInt, S5 generic errors)
api.get("/ingest", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const limit = safeParseInt(c.req.query("limit"), 3);
  const docId = c.req.query("doc") || "";

  try {
    const sources = await c.env.DB.prepare("SELECT * FROM sources").all();
    if (!sources.results.length) {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO sources (google_doc_id, title) VALUES ('1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA', 'Bits and Bobs (Current)')"
      ).run();
    }

    let source: any;
    if (docId) {
      source = await c.env.DB.prepare("SELECT * FROM sources WHERE google_doc_id = ?").bind(docId).first();
    } else {
      source = await c.env.DB.prepare(
        "SELECT * FROM sources ORDER BY last_fetched_at IS NOT NULL, last_fetched_at ASC LIMIT 1"
      ).first();
    }

    if (!source) return c.json({ error: "No source found" }, 404);

    const fetched = await fetchGoogleDoc(source.google_doc_id);
    const allEpisodes = parseHtmlDocument(fetched.html);

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
    console.error("Ingest error:", e); // B2: log the error
    return c.json({ error: "Ingestion failed" }, 500); // S5: generic message
  }
});

// Admin: generate embeddings (S1 auth)
api.get("/embed", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const limit = safeParseInt(c.req.query("limit"), 10);

  try {
    const chunks = await c.env.DB.prepare(
      "SELECT id, content_plain, vector_id FROM chunks LIMIT ?"
    ).bind(limit).all();

    if (!chunks.results.length) return c.json({ status: "no chunks to embed" });

    // P1: batch embedding instead of per-chunk calls
    const texts = (chunks.results as any[]).map((c) => c.content_plain);
    const result = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: texts });

    const vectors = (chunks.results as any[]).map((chunk, i) => ({
      id: chunk.vector_id,
      values: (result as any).data[i],
      metadata: { chunkId: chunk.id },
    }));

    await c.env.VECTORIZE.upsert(vectors);
    return c.json({ status: "ok", embedded: vectors.length });
  } catch (e: any) {
    console.error("Embed error:", e);
    return c.json({ error: "Embedding failed" }, 500);
  }
});

// Admin: enrich unenriched chunks (topics, word stats)
api.get("/enrich", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const batchSize = safeParseInt(c.req.query("batch"), 50);

  try {
    const result = await enrichChunks(c.env.DB, batchSize);
    const complete = await isEnrichmentComplete(c.env.DB);
    return c.json({
      status: "ok",
      chunksProcessed: result.chunksProcessed,
      complete,
    });
  } catch (e: any) {
    console.error("Enrich error:", e);
    return c.json({ error: "Enrichment failed" }, 500);
  }
});

// Topic search API
api.get("/topics", async (c) => {
  const q = c.req.query("q")?.trim().toLowerCase() || "";
  if (!q || q.length < 2) return c.json({ topics: [] });

  const result = await c.env.DB.prepare(
    "SELECT name, slug, usage_count FROM topics WHERE name LIKE ? ESCAPE '\\' AND usage_count >= 1 ORDER BY usage_count DESC LIMIT 10"
  ).bind(`%${escapeLike(q)}%`).all();

  return c.json({ topics: result.results });
});

// Reactive API: word stats with date filtering
api.get("/word-stats", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = safeParseInt(c.req.query("limit"), 200);

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
    query = "SELECT word, total_count, doc_count FROM word_stats ORDER BY total_count DESC LIMIT ?";
    binds = [limit];
  }

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  return c.json({ words: results.results });
});

export { api as apiRoutes };
