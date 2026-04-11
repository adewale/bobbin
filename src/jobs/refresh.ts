import { fetchGoogleDocHtml } from "../services/google-docs";
import { parseHtmlDocument } from "../services/html-parser";
import { ingestParsedEpisodes } from "./ingest";
import type { Bindings, SourceRow } from "../types";

// The current doc where Komoroske publishes new content
const CURRENT_DOC_ID = "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA";

/**
 * Weekly cron refresh: only fetch the CURRENT doc (where new content appears).
 * Archives don't change — they're ingested once via /api/ingest.
 *
 * Designed to complete within Workers CPU limits:
 * - Fetches 1 doc (not all sources)
 * - Ingests only NEW episodes (dedup by date within source)
 * - Skips AI operations in cron (embeddings done separately via /api/embed)
 */
export async function runRefresh(env: Bindings): Promise<void> {
  // Ensure the current doc source exists
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
    const html = await fetchGoogleDocHtml(source.google_doc_id);
    const episodes = parseHtmlDocument(html);

    // Only ingest new episodes (limited to 5 per run to stay within CPU budget)
    const result = await ingestParsedEpisodes(env, source.id, episodes);

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
