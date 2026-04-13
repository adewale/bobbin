import { fetchGoogleDoc, parseHtmlDocument, ingestEpisodesOnly, enrichAllChunks, finalizeEnrichment } from "../crawler";
import { ensureSource, getSourceByDocId, updateSourceFetchedAt } from "../db/sources";
import { createIngestionLog, completeIngestionLog, failIngestionLog } from "../db/ingestion";
import type { Bindings } from "../types";

const CURRENT_DOC_ID = "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA";

/**
 * Canonical log line for the refresh pipeline.
 * One structured object per run — contains everything needed to understand
 * what happened, how long it took, and what went wrong.
 */
interface RefreshEvent {
  event: "refresh";
  source: string;
  started_at: string;
  status: "completed" | "failed";
  duration_ms: number;
  // Per-step timing
  fetch_ms?: number;
  parse_ms?: number;
  ingest_ms?: number;
  enrich_ms?: number;
  finalize_ms?: number;
  // Counts
  parse_episodes?: number;
  parse_chunks?: number;
  new_episodes?: number;
  new_chunks?: number;
  enriched_chunks?: number;
  // Error info
  failed_step?: string;
  error?: string;
}

function elapsed(start: number): number {
  return Math.round(Date.now() - start);
}

export async function runRefresh(env: Bindings): Promise<RefreshEvent> {
  const runStart = Date.now();
  const event: RefreshEvent = {
    event: "refresh",
    source: CURRENT_DOC_ID.substring(0, 12) + "...",
    started_at: new Date().toISOString(),
    status: "completed",
    duration_ms: 0,
  };

  let logId: number | null = null;
  let currentStep = "init";

  try {
    // --- Setup ---
    currentStep = "ensureSource";
    await ensureSource(env.DB, CURRENT_DOC_ID, "Bits and Bobs (Current)");
    const source = await getSourceByDocId(env.DB, CURRENT_DOC_ID);
    if (!source) {
      event.status = "failed";
      event.failed_step = "getSource";
      event.error = "Source not found after ensureSource";
      event.duration_ms = elapsed(runStart);
      console.log(JSON.stringify(event));
      return event;
    }

    logId = await createIngestionLog(env.DB, source.id);

    // --- Fetch ---
    currentStep = "fetch";
    const fetchStart = Date.now();
    const fetched = await fetchGoogleDoc(source.google_doc_id);
    event.fetch_ms = elapsed(fetchStart);

    // --- Parse ---
    currentStep = "parse";
    const parseStart = Date.now();
    const episodes = parseHtmlDocument(fetched.html);
    event.parse_ms = elapsed(parseStart);
    event.parse_episodes = episodes.length;
    event.parse_chunks = episodes.reduce((sum, ep) => sum + ep.chunks.length, 0);

    // --- Ingest ---
    currentStep = "ingest";
    const ingestStart = Date.now();
    const result = await ingestEpisodesOnly(env.DB, source.id, episodes);
    event.ingest_ms = elapsed(ingestStart);
    event.new_episodes = result.episodesAdded;
    event.new_chunks = result.chunksAdded;

    // --- Enrich (only if new chunks, or unenriched chunks exist) ---
    currentStep = "enrich";
    const enrichStart = Date.now();
    if (result.chunksAdded > 0) {
      const enriched = await enrichAllChunks(env.DB, 200, 120000);
      event.enriched_chunks = enriched;
    } else {
      // Check for leftover unenriched chunks from previous runs
      const enriched = await enrichAllChunks(env.DB, 200, 30000);
      event.enriched_chunks = enriched;
    }
    event.enrich_ms = elapsed(enrichStart);

    // --- Finalize (only if we enriched something, or if new content was added) ---
    currentStep = "finalize";
    const finalizeStart = Date.now();
    if ((event.enriched_chunks ?? 0) > 0 || result.chunksAdded > 0) {
      await finalizeEnrichment(env.DB, env.ENRICHMENT_QUEUE);
    }
    event.finalize_ms = elapsed(finalizeStart);

    // --- Complete ---
    currentStep = "complete";
    await updateSourceFetchedAt(env.DB, source.id);
    await completeIngestionLog(env.DB, logId, result.episodesAdded, result.chunksAdded);

    event.status = "completed";
    event.duration_ms = elapsed(runStart);
    console.log(JSON.stringify(event));
    return event;

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    event.status = "failed";
    event.failed_step = currentStep;
    event.error = msg.substring(0, 500);
    event.duration_ms = elapsed(runStart);

    console.error(JSON.stringify(event));

    if (logId) {
      try {
        await failIngestionLog(env.DB, logId, msg);
      } catch {
        // Don't mask the original error
      }
    }

    return event;
  }
}
