import { Hono } from "hono";
import type { AppEnv } from "../types";
import { fetchGoogleDoc } from "../crawler/fetch";
import { parseHtmlDocument } from "../services/html-parser";
import { backfillExistingEpisodes, ingestParsedEpisodes, enrichChunks, finalizeEnrichment, isEnrichmentComplete } from "../jobs/ingest";
import { createIngestionLog, completeIngestionLog, failIngestionLog } from "../db/ingestion";
import { recordPipelineRun } from "../db/pipeline-metrics";
import { ftsSearch } from "../services/search";
import { enrichEpisodeIdsWithLlm, enrichEpisodesWithLlm } from "../services/llm-ingest";
import { persistSourceHtmlChunks } from "../db/artifacts";
import { parseSearchQuery } from "../lib/query-parser";
import { keywordSearch } from "../db/search";
import { collectInBatches, MAX_SQL_BINDINGS, sqlPlaceholders } from "../lib/db";
import { safeParseInt, escapeLike } from "../lib/html";
import { applyTopicBoost } from "../services/search-topics";
import { expandEntityAliases } from "../lib/entity-aliases";
import { KNOWN_ENTITIES } from "../data/known-entities";
import { combinePipelineReports, summarizeEnrichBatches, summarizeFinalizeResult } from "../services/pipeline-report";
import { normalizeTopicExtractorMode } from "../services/yake-runtime";
import { runRefresh } from "../jobs/refresh";

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

    // Entity alias expansion: each term individually quoted for FTS5
    const entityAliases = expandEntityAliases(parsed.text, KNOWN_ENTITIES);
    if (entityAliases.length > 0) {
      const uniqueTerms = new Set([
        parsed.text.toLowerCase(),
        ...entityAliases,
      ]);
      parsed.text = [...uniqueTerms]
        .filter(Boolean)
        .map((t) => (t.includes(" ") ? `"${t}"` : t))
        .join(" OR ");
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
  let logId: number | null = null;
  let sourceForLog: { id: number; title: string; google_doc_id: string } | null = null;
  const extractorMode = normalizeTopicExtractorMode(c.env.TOPIC_EXTRACTOR_MODE);

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
      // Default: pick the most recently created source (the "current" doc),
      // not the oldest last_fetched_at (which may be an archive)
      source = await c.env.DB.prepare(
        "SELECT * FROM sources ORDER BY created_at DESC LIMIT 1"
      ).first();
    }

    if (!source) return c.json({ error: "No source found" }, 404);

    sourceForLog = source as { id: number; title: string; google_doc_id: string };
    logId = await createIngestionLog(c.env.DB, source.id, "manual_ingest");
    const fetched = await fetchGoogleDoc(source.google_doc_id);
    await c.env.DB.prepare(
      "UPDATE sources SET latest_html = NULL WHERE id = ?"
    ).bind(source.id).run();
    await persistSourceHtmlChunks(c.env.DB, source.id, fetched.html, fetched.fetchedAt);
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

    await completeIngestionLog(c.env.DB, logId, result.episodesAdded, result.chunksAdded, {
      endpoint: "/api/ingest",
      extractor_mode: extractorMode,
      source_id: source.id,
      source_title: source.title,
      fetch_doc_id: source.google_doc_id,
      total_in_doc: allEpisodes.length,
      new_episodes_found: newEpisodes.length,
      batch_requested: limit,
      batch_size: batch.length,
      enrich_batch: result.enrichBatch || null,
      finalize: result.finalize || null,
    });

    const runReport = combinePipelineReports(
      "manual_ingest",
      extractorMode,
      result.enrichBatch ? [result.enrichBatch] : [],
      result.finalize,
      source.id,
    );
    await recordPipelineRun(c.env.DB, logId, runReport.summary, runReport.stages);

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
    if (logId) {
      await failIngestionLog(c.env.DB, logId, e instanceof Error ? e.message : String(e), {
        endpoint: "/api/ingest",
        extractor_mode: extractorMode,
        source_id: sourceForLog?.id || null,
        source_title: sourceForLog?.title || null,
        fetch_doc_id: sourceForLog?.google_doc_id || null,
        batch_requested: limit,
      });
    }
    return c.json({ error: "Ingestion failed" }, 500); // S5: generic message
  }
});

api.get("/refresh", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const event = await runRefresh(c.env);
  return c.json(event);
});

api.get("/backfill-source", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const docId = c.req.query("doc") || "";
  const limit = safeParseInt(c.req.query("limit"), 0);
  const offset = safeParseInt(c.req.query("offset"), 0);
  const runLlm = c.req.query("llm") !== "0";
  if (!docId) return c.json({ error: "doc is required" }, 400);

  try {
    const source = await c.env.DB.prepare("SELECT * FROM sources WHERE google_doc_id = ?").bind(docId).first<any>();
    if (!source) return c.json({ error: "No source found" }, 404);

    const fetched = await fetchGoogleDoc(source.google_doc_id);
    await c.env.DB.prepare(
      "UPDATE sources SET latest_html = NULL, last_fetched_at = datetime('now') WHERE id = ?"
    ).bind(source.id).run();
    await persistSourceHtmlChunks(c.env.DB, source.id, fetched.html, fetched.fetchedAt);

    const episodes = parseHtmlDocument(fetched.html);
    const windowedEpisodes = limit > 0 ? episodes.slice(offset, offset + limit) : episodes;
    const backfilled = await backfillExistingEpisodes(c.env.DB, source.id, windowedEpisodes);
    if (runLlm && backfilled.backfilledEpisodes.length > 0) {
      await enrichEpisodesWithLlm(c.env, source.id, backfilled.backfilledEpisodes);
    }

    return c.json({
      status: "ok",
      source: source.title,
      totalEpisodesInSource: episodes.length,
      episodesProcessed: windowedEpisodes.length,
      offset,
      limit,
      llmEnabled: runLlm,
      episodesUpdated: backfilled.episodesUpdated,
      chunksUpdated: backfilled.chunksUpdated,
      llmEpisodesUpdated: runLlm ? backfilled.backfilledEpisodes.length : 0,
    });
  } catch (e) {
    console.error("Backfill source error:", e);
    return c.json({ error: "Backfill failed", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

api.get("/backfill-llm", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const docId = c.req.query("doc") || "";
  const limit = safeParseInt(c.req.query("limit"), 10);

  try {
    let sourceFilter = "";
    const binds: (string | number)[] = [];
    if (docId) {
      sourceFilter = "AND s.google_doc_id = ?";
      binds.push(docId);
    }

    const pending = await c.env.DB.prepare(
      `SELECT e.id, e.slug, s.id as source_id, s.title as source_title
       FROM episodes e
       JOIN sources s ON s.id = e.source_id
       WHERE NOT EXISTS (SELECT 1 FROM llm_enrichment_runs r WHERE r.episode_id = e.id)
       ${sourceFilter}
       ORDER BY e.published_date ASC
       LIMIT ?`
    ).bind(...binds, limit).all<{ id: number; slug: string; source_id: number; source_title: string }>();

    if (pending.results.length === 0) {
      return c.json({ status: "ok", dispatched: 0, mode: "noop" });
    }

    if (c.env.ENRICHMENT_QUEUE) {
      const messages = pending.results.map((row) => ({ body: { type: "llm-episode-enrich" as const, episodeId: row.id } }));
      for (let i = 0; i < messages.length; i += 25) {
        await c.env.ENRICHMENT_QUEUE.sendBatch(messages.slice(i, i + 25));
      }
      return c.json({ status: "ok", dispatched: pending.results.length, mode: "queue" });
    }

    const episodeIds = pending.results.map((row) => row.id);
    const processed = await enrichEpisodeIdsWithLlm(c.env, episodeIds);
    return c.json({ status: "ok", dispatched: processed, mode: "inline" });
  } catch (e) {
    console.error("Backfill LLM error:", e);
    return c.json({ error: "LLM backfill failed", detail: e instanceof Error ? e.message : String(e) }, 500);
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
  let logId: number | null = null;
  const extractorMode = normalizeTopicExtractorMode(c.env.TOPIC_EXTRACTOR_MODE);

  try {
    logId = await createIngestionLog(c.env.DB, null, "enrich");
    const result = await enrichChunks(c.env.DB, batchSize, extractorMode);
    const complete = await isEnrichmentComplete(c.env.DB);
    await completeIngestionLog(c.env.DB, logId, 0, result.chunksProcessed, {
      endpoint: "/api/enrich",
      extractor_mode: extractorMode,
      batch_size: batchSize,
      complete,
      enrich_batch: result.batch || null,
    });
    if (result.batch) {
      const runReport = summarizeEnrichBatches("enrich", extractorMode, [result.batch]);
      await recordPipelineRun(c.env.DB, logId, runReport.summary, runReport.stages);
    }
    return c.json({
      status: "ok",
      chunksProcessed: result.chunksProcessed,
      complete,
    });
  } catch (e: any) {
    console.error("Enrich error:", e);
    if (logId) {
      await failIngestionLog(c.env.DB, logId, e instanceof Error ? e.message : String(e), {
        endpoint: "/api/enrich",
        extractor_mode: extractorMode,
        batch_size: batchSize,
      });
    }
    return c.json({ error: "Enrichment failed" }, 500);
  }
});

// Admin: dispatch enrichment batches to queue for parallel processing
api.get("/enrich-parallel", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const batchSize = Math.min(Math.max(safeParseInt(c.req.query("batch"), 200), 1), MAX_SQL_BINDINGS);

  try {
    const { CURRENT_ENRICHMENT_VERSION } = await import("../jobs/ingest");
    const unenriched = await c.env.DB.prepare(
      `WITH pending_chunks AS (
         SELECT id FROM chunks WHERE enriched = 0
         UNION
         SELECT id FROM chunks WHERE enriched != 0 AND enrichment_version < ?
       )
       SELECT id FROM pending_chunks ORDER BY id DESC LIMIT 5000`
    ).bind(CURRENT_ENRICHMENT_VERSION).all<{ id: number }>();

    if (!unenriched.results.length) {
      return c.json({ status: "ok", dispatched: 0, batches: 0, complete: true });
    }

    // Split into batches and dispatch to queue
    const ids = unenriched.results.map(r => r.id);
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      batches.push(ids.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      await c.env.ENRICHMENT_QUEUE.send({ type: "enrich-batch", chunkIds: batch });
    }

    return c.json({ status: "ok", dispatched: ids.length, batches: batches.length });
  } catch (e: any) {
    console.error("Enrich-parallel error:", e);
    return c.json({ error: "Parallel enrichment dispatch failed" }, 500);
  }
});

// Admin: one-time cleanup of stale chunk_topics and orphan topics
api.get("/cleanup-stale", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  try {
    const { CURRENT_ENRICHMENT_VERSION } = await import("../jobs/ingest");
    const db = c.env.DB;

    // Step 1: Delete chunk_topics for chunks with outdated enrichment_version
    // These are stale links from v1/v2/v3 enrichment keeping old topics alive
    const staleChunks = await db.prepare(
      "SELECT COUNT(*) as c FROM chunks WHERE enrichment_version < ?"
    ).bind(CURRENT_ENRICHMENT_VERSION).first<{ c: number }>();

    let staleLinksDeleted = 0;
    if (staleChunks && staleChunks.c > 0) {
      // Delete in batches of chunk IDs
      const BATCH = 90;
      let offset = 0;
      while (true) {
        const batch = await db.prepare(
          "SELECT id FROM chunks WHERE enrichment_version < ? LIMIT ? OFFSET ?"
        ).bind(CURRENT_ENRICHMENT_VERSION, BATCH, offset).all<{ id: number }>();
        if (batch.results.length === 0) break;

        const ids = batch.results.map(r => r.id);
        const ph = ids.map(() => "?").join(",");
        const result = await db.prepare(
          `DELETE FROM chunk_topics WHERE chunk_id IN (${ph})`
        ).bind(...ids).run();
        staleLinksDeleted += result.meta.changes || 0;

        // Also clean episode_topics
        const epIds = await db.prepare(
          `SELECT DISTINCT episode_id FROM chunks WHERE id IN (${ph})`
        ).bind(...ids).all<{ episode_id: number }>();
        for (const ep of epIds.results) {
          await db.prepare("DELETE FROM episode_topics WHERE episode_id = ?").bind(ep.episode_id).run();
        }

        offset += BATCH;
      }
    }

    // Step 2: Delete orphan topics (no chunk_topics links)
    let orphansDeleted = 0;
    while (true) {
      const result = await db.prepare(
        `DELETE FROM topics WHERE kind != 'entity'
         AND NOT EXISTS (SELECT 1 FROM chunk_topics WHERE topic_id = topics.id)
         LIMIT 1000`
      ).run();
      orphansDeleted += result.meta.changes || 0;
      if ((result.meta.changes || 0) === 0) break;
    }

    return c.json({
      status: "ok",
      stale_chunks: staleChunks?.c || 0,
      stale_links_deleted: staleLinksDeleted,
      orphans_deleted: orphansDeleted,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Admin: finalize enrichment (run once after all chunks enriched)
api.get("/finalize", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  let logId: number | null = null;
  const extractorMode = normalizeTopicExtractorMode(c.env.TOPIC_EXTRACTOR_MODE);

  try {
    logId = await createIngestionLog(c.env.DB, null, "finalize");
    const result = await finalizeEnrichment(c.env.DB, c.env.ENRICHMENT_QUEUE);
    const failedSteps = result.steps.filter(s => s.status === "error");
    await completeIngestionLog(
      c.env.DB,
      logId,
      0,
      0,
      { endpoint: "/api/finalize", extractor_mode: extractorMode, finalize: result },
      failedSteps.length > 0 ? "partial" : "completed"
    );
    const runReport = summarizeFinalizeResult("finalize", extractorMode, result);
    await recordPipelineRun(c.env.DB, logId, runReport.summary, runReport.stages);
    if (failedSteps.length > 0) {
      return c.json({ status: "partial", failed_count: failedSteps.length, ...result });
    }
    return c.json({ status: "ok", ...result });
  } catch (e: any) {
    console.error("Finalize error:", e);
    if (logId) {
      await failIngestionLog(c.env.DB, logId, e instanceof Error ? e.message : String(e), {
        endpoint: "/api/finalize",
        extractor_mode: extractorMode,
      });
    }
    return c.json({
      error: "Finalization failed",
      failed_step: e.message?.substring(0, 200),
      detail: e.stack?.substring(0, 500),
    }, 500);
  }
});

api.get("/pipeline-runs", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const limit = safeParseInt(c.req.query("limit"), 20);
  const runs = await c.env.DB.prepare(
    `SELECT pr.*, il.started_at, il.completed_at
     FROM pipeline_runs pr
     LEFT JOIN ingestion_log il ON il.id = pr.ingestion_log_id
     ORDER BY pr.id DESC
     LIMIT ?`
  ).bind(limit).all();

  const runIds = (runs.results as any[]).map((run) => run.id);
  let stages: any[] = [];
  if (runIds.length > 0) {
    stages = await collectInBatches(runIds, async (runIdBatch) => {
      const placeholders = sqlPlaceholders(runIdBatch.length);
      const stageRows = await c.env.DB.prepare(
        `SELECT pipeline_run_id, phase, stage_name, stage_order, status, duration_ms, counts_json, detail
         FROM pipeline_stage_metrics
         WHERE pipeline_run_id IN (${placeholders})
         ORDER BY pipeline_run_id DESC, phase ASC, stage_order ASC`
      ).bind(...runIdBatch).all();
      return stageRows.results as any[];
    });
  }

  return c.json({ runs: runs.results, stages });
});

// Admin: view ingestion history
api.get("/ingestion-log", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const result = await c.env.DB.prepare(
    `SELECT il.*, s.title as source_title
     FROM ingestion_log il
     LEFT JOIN sources s ON il.source_id = s.id
     ORDER BY il.started_at DESC
     LIMIT 20`
  ).all();

  return c.json({ runs: result.results });
});

// Admin: pipeline health check
api.get("/health", async (c) => {
  const denied = requireAuth(c);
  if (denied) return denied;

  const [chunks, topics, unenriched, lastRun] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as c FROM chunks").first<{ c: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM topics WHERE usage_count > 0").first<{ c: number }>(),
    (async () => {
      const { CURRENT_ENRICHMENT_VERSION } = await import("../jobs/ingest");
      return c.env.DB.prepare(
        `SELECT (
           SELECT COUNT(*) FROM chunks WHERE enriched = 0
         ) + (
           SELECT COUNT(*) FROM chunks WHERE enriched != 0 AND enrichment_version < ?
         ) as c`
      ).bind(CURRENT_ENRICHMENT_VERSION).first<{ c: number }>();
    })(),
    c.env.DB.prepare("SELECT * FROM ingestion_log ORDER BY started_at DESC LIMIT 1").first(),
  ]);

  return c.json({
    chunks: chunks?.c || 0,
    active_topics: topics?.c || 0,
    unenriched_chunks: unenriched?.c || 0,
    last_run: lastRun || null,
  });
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
