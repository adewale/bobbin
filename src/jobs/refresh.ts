import { fetchGoogleDoc } from "../crawler/fetch";
import { persistSourceHtmlChunks } from "../db/artifacts";
import { parseHtmlDocument } from "../services/html-parser";
import { ingestEpisodesOnly, enrichAllChunks, finalizeEnrichment, type ProcessChunkBatchResult, type FinalizeResult } from "./ingest";
import { enrichEpisodesWithLlm } from "../services/llm-ingest";
import { ensureSource, getSourceByDocId, updateSourceFetchedAt } from "../db/sources";
import { createIngestionLog, completeIngestionLog, failIngestionLog } from "../db/ingestion";
import { recordPipelineRun } from "../db/pipeline-metrics";
import { combinePipelineReports } from "../services/pipeline-report";
import { normalizeTopicExtractorMode } from "../services/yake-runtime";
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

interface RefreshPipelineReport {
  event: RefreshEvent;
  enrich_batches: ProcessChunkBatchResult[];
  finalize?: FinalizeResult;
}

function elapsed(start: number): number {
  return Math.round(Date.now() - start);
}

export async function runRefresh(env: Bindings): Promise<RefreshEvent> {
  const runStart = Date.now();
  const extractorMode = normalizeTopicExtractorMode(env.TOPIC_EXTRACTOR_MODE);
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
    await env.DB.prepare(
      "UPDATE sources SET latest_html = NULL WHERE id = ?"
    ).bind(source.id).run();
    await persistSourceHtmlChunks(env.DB, source.id, fetched.html, fetched.fetchedAt);
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

    currentStep = "llm_enrich";
    if (result.insertedEpisodes.length > 0) {
      await enrichEpisodesWithLlm(env, source.id, result.insertedEpisodes);
    }

    // --- Enrich (only if new chunks, or unenriched chunks exist) ---
    currentStep = "enrich";
    const enrichStart = Date.now();
    const enrichBatches: ProcessChunkBatchResult[] = [];
    if (result.chunksAdded > 0) {
      const enriched = await enrichAllChunks(env.DB, 200, 120000, (batch) => {
        enrichBatches.push(batch);
      }, extractorMode);
      event.enriched_chunks = enriched;
    } else {
      // Check for leftover unenriched chunks from previous runs
      const enriched = await enrichAllChunks(env.DB, 200, 30000, (batch) => {
        enrichBatches.push(batch);
      }, extractorMode);
      event.enriched_chunks = enriched;
    }
    event.enrich_ms = elapsed(enrichStart);

    // --- Finalize (only if we enriched something, or if new content was added) ---
    currentStep = "finalize";
    const finalizeStart = Date.now();
    let finalizeResult: FinalizeResult | undefined;
    if ((event.enriched_chunks ?? 0) > 0 || result.chunksAdded > 0) {
      finalizeResult = await finalizeEnrichment(env.DB, env.ENRICHMENT_QUEUE);
      const failedSteps = finalizeResult.steps.filter((step) => step.status === "error");
      if (failedSteps.length > 0) {
        throw new Error(`Finalization failed in steps: ${failedSteps.map((step) => step.name).join(", ")}`);
      }
    }
    event.finalize_ms = elapsed(finalizeStart);

    // --- Complete ---
    currentStep = "complete";
    await updateSourceFetchedAt(env.DB, source.id);
    const pipelineReport: RefreshPipelineReport = {
      event,
      enrich_batches: enrichBatches,
      ...(finalizeResult ? { finalize: finalizeResult } : {}),
    };
    await completeIngestionLog(env.DB, logId, result.episodesAdded, result.chunksAdded, pipelineReport);
    const runReport = combinePipelineReports("refresh", extractorMode, enrichBatches, finalizeResult, source.id);
    await recordPipelineRun(env.DB, logId, runReport.summary, runReport.stages);

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
        await failIngestionLog(env.DB, logId, msg, { event });
        await recordPipelineRun(env.DB, logId, {
          sourceId: null,
          runType: "refresh",
          extractorMode,
          status: "failed",
          totalMs: event.duration_ms,
          chunksProcessed: 0,
          candidatesGenerated: 0,
          candidatesRejectedEarly: 0,
          candidatesInserted: 0,
          topicsInserted: 0,
          chunkTopicLinksInserted: 0,
          chunkWordRowsInserted: 0,
          pruned: 0,
          merged: 0,
          orphanTopicsDeleted: 0,
          archivedLineageTopics: 0,
        }, []);
      } catch {
        // Don't mask the original error
      }
    }

    return event;
  }
}
