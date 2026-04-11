import { fetchGoogleDocHtml } from "../services/google-docs";
import { parseHtmlDocument } from "../services/html-parser";
import { ingestEpisodesOnly, enrichChunks } from "./ingest";
import type { Bindings, SourceRow } from "../types";

const CURRENT_DOC_ID = "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA";

/**
 * Weekly cron refresh — phased approach:
 * 1. Fetch current doc, insert new episodes + chunks (fast, <10s)
 * 2. Enrich a batch of unenriched chunks (tags, concordance)
 *
 * If there are more unenriched chunks than one batch can handle,
 * the next cron run will continue where this one left off.
 */
export async function runRefresh(env: Bindings): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO sources (google_doc_id, title) VALUES (?, ?)"
  )
    .bind(CURRENT_DOC_ID, "Bits and Bobs (Current)")
    .run();

  const source = await env.DB.prepare(
    "SELECT * FROM sources WHERE google_doc_id = ?"
  )
    .bind(CURRENT_DOC_ID)
    .first<SourceRow>();

  if (!source) return;

  const logResult = await env.DB.prepare(
    "INSERT INTO ingestion_log (source_id, status) VALUES (?, 'running')"
  )
    .bind(source.id)
    .run();
  const logId = logResult.meta.last_row_id;

  try {
    // Phase 1: Fetch + insert episodes/chunks
    const html = await fetchGoogleDocHtml(source.google_doc_id);
    const episodes = parseHtmlDocument(html);
    const result = await ingestEpisodesOnly(env.DB, source.id, episodes);

    // Phase 2: Enrich a batch of unenriched chunks (50 per run)
    const enrichResult = await enrichChunks(env.DB, 50);

    await env.DB.prepare(
      "UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?"
    )
      .bind(source.id)
      .run();

    await env.DB.prepare(
      `UPDATE ingestion_log SET status = 'completed', completed_at = datetime('now'),
       episodes_added = ?, chunks_added = ? WHERE id = ?`
    )
      .bind(result.episodesAdded, result.chunksAdded, logId)
      .run();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Refresh failed:", msg);
    await env.DB.prepare(
      `UPDATE ingestion_log SET status = 'failed', completed_at = datetime('now'),
       error_message = ? WHERE id = ?`
    )
      .bind(msg.substring(0, 500), logId)
      .run();
  }
}
