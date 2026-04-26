import { fetchGoogleDoc } from "../crawler/fetch";
import { persistSourceHtmlChunks } from "../db/artifacts";
import { createIngestionLog, completeIngestionLog, failIngestionLog } from "../db/ingestion";
import { recordPipelineRun } from "../db/pipeline-metrics";
import {
  ensureKnownSources,
  getRefreshSources,
  markSourceRefreshFailed,
  markSourceRefreshStarted,
  markSourceRefreshSucceeded,
} from "../db/sources";
import { parseHtmlDocument } from "../services/html-parser";
import { enrichEpisodesWithLlm } from "../services/llm-ingest";
import { combinePipelineReports } from "../services/pipeline-report";
import { normalizeTopicExtractorMode } from "../services/yake-runtime";
import type { Bindings, SourceRow } from "../types";
import { enrichAllChunks, finalizeEnrichment, ingestEpisodesOnly, type FinalizeResult, type ProcessChunkBatchResult } from "./ingest";

/**
 * Canonical log line for the refresh pipeline.
 * One structured object per run — contains everything needed to understand
 * what happened, how long it took, and what went wrong.
 */
interface RefreshEvent {
  event: "refresh";
  source: string;
  sources_processed?: number;
  sources_failed?: number;
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

type RefreshFetcher = typeof fetchGoogleDoc;
type RefreshLlmEnricher = typeof enrichEpisodesWithLlm;

function elapsed(start: number): number {
  return Math.round(Date.now() - start);
}

async function tryCreatePipelineLog(db: D1Database, sourceId: number | null) {
  try {
    return await createIngestionLog(db, sourceId);
  } catch (error) {
    console.error("Refresh log create failed:", error);
    return null;
  }
}

async function tryCompletePipelineLog(db: D1Database, logId: number | null, episodesAdded: number, chunksAdded: number, pipelineReport?: unknown) {
  if (!logId) return;
  try {
    await completeIngestionLog(db, logId, episodesAdded, chunksAdded, pipelineReport);
  } catch (error) {
    console.error("Refresh log complete failed:", error);
  }
}

async function tryFailPipelineLog(db: D1Database, logId: number | null, message: string, pipelineReport?: unknown) {
  if (!logId) return;
  try {
    await failIngestionLog(db, logId, message, pipelineReport);
  } catch (error) {
    console.error("Refresh log fail failed:", error);
  }
}

async function tryRecordPipeline(db: D1Database, logId: number | null, summary: unknown, stages: unknown[]) {
  if (!logId) return;
  try {
    await recordPipelineRun(db, logId, summary as any, stages as any);
  } catch (error) {
    console.error("Refresh pipeline metrics write failed:", error);
  }
}

async function runRefreshForSource(
  env: Bindings,
  source: Pick<SourceRow, "id" | "title" | "google_doc_id">,
  extractorMode: ReturnType<typeof normalizeTopicExtractorMode>,
  fetchDoc: RefreshFetcher,
  llmEnricher: RefreshLlmEnricher,
): Promise<RefreshEvent> {
  const runStart = Date.now();
  const event: RefreshEvent = {
    event: "refresh",
    source: source.google_doc_id.substring(0, 12) + "...",
    started_at: new Date().toISOString(),
    status: "completed",
    duration_ms: 0,
  };

  let logId: number | null = null;
  let currentStep = "init";

  try {
    logId = await tryCreatePipelineLog(env.DB, source.id);
    await markSourceRefreshStarted(env.DB, source.id);

    currentStep = "fetch";
    const fetchStart = Date.now();
    const fetched = await fetchDoc(source.google_doc_id);
    await env.DB.prepare("UPDATE sources SET latest_html = NULL WHERE id = ?").bind(source.id).run();
    await persistSourceHtmlChunks(env.DB, source.id, fetched.html, fetched.fetchedAt);
    event.fetch_ms = elapsed(fetchStart);

    currentStep = "parse";
    const parseStart = Date.now();
    const episodes = parseHtmlDocument(fetched.html);
    event.parse_ms = elapsed(parseStart);
    event.parse_episodes = episodes.length;
    event.parse_chunks = episodes.reduce((sum, ep) => sum + ep.chunks.length, 0);

    currentStep = "ingest";
    const ingestStart = Date.now();
    const result = await ingestEpisodesOnly(env.DB, source.id, episodes);
    event.ingest_ms = elapsed(ingestStart);
    event.new_episodes = result.episodesAdded;
    event.new_chunks = result.chunksAdded;

    currentStep = "llm_enrich";
    if (result.insertedEpisodes.length > 0) {
      await llmEnricher(env, source.id, result.insertedEpisodes);
    }

    currentStep = "enrich";
    const enrichStart = Date.now();
    const enrichBatches: ProcessChunkBatchResult[] = [];
    const enriched = await enrichAllChunks(
      env.DB,
      200,
      result.chunksAdded > 0 ? 120000 : 30000,
      (batch) => {
        enrichBatches.push(batch);
      },
      extractorMode,
    );
    event.enriched_chunks = enriched;
    event.enrich_ms = elapsed(enrichStart);

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

    currentStep = "complete";
    await markSourceRefreshSucceeded(env.DB, source.id);
    const pipelineReport: RefreshPipelineReport = {
      event,
      enrich_batches: enrichBatches,
      ...(finalizeResult ? { finalize: finalizeResult } : {}),
    };
    await tryCompletePipelineLog(env.DB, logId, result.episodesAdded, result.chunksAdded, pipelineReport);
    const runReport = combinePipelineReports("refresh", extractorMode, enrichBatches, finalizeResult, source.id);
    await tryRecordPipeline(env.DB, logId, runReport.summary, runReport.stages);

    event.duration_ms = elapsed(runStart);
    return event;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    event.status = "failed";
    event.failed_step = currentStep;
    event.error = msg.substring(0, 500);
    event.duration_ms = elapsed(runStart);
    await markSourceRefreshFailed(env.DB, source.id, msg);
    await tryFailPipelineLog(env.DB, logId, msg, { event });
    return event;
  }
}

export async function runRefresh(env: Bindings): Promise<RefreshEvent> {
  const runStart = Date.now();
  const extractorMode = normalizeTopicExtractorMode(env.TOPIC_EXTRACTOR_MODE);
  const fetchDoc: RefreshFetcher = typeof (env as any).__TEST_FETCH_GOOGLE_DOC === "function"
    ? (env as any).__TEST_FETCH_GOOGLE_DOC
    : fetchGoogleDoc;
  const llmEnricher: RefreshLlmEnricher = typeof (env as any).__TEST_ENRICH_EPISODES_WITH_LLM === "function"
    ? (env as any).__TEST_ENRICH_EPISODES_WITH_LLM
    : enrichEpisodesWithLlm;
  const aggregate: RefreshEvent = {
    event: "refresh",
    source: "all",
    started_at: new Date().toISOString(),
    status: "completed",
    duration_ms: 0,
    sources_processed: 0,
    sources_failed: 0,
    parse_episodes: 0,
    parse_chunks: 0,
    new_episodes: 0,
    new_chunks: 0,
    enriched_chunks: 0,
  };

  try {
    await ensureKnownSources(env.DB);
    const sources = await getRefreshSources(env.DB);
    if (sources.length === 0) {
      aggregate.status = "failed";
      aggregate.failed_step = "load_sources";
      aggregate.error = "No refresh sources configured";
      aggregate.duration_ms = elapsed(runStart);
      console.log(JSON.stringify(aggregate));
      return aggregate;
    }

    let totalFetchMs = 0;
    let totalParseMs = 0;
    let totalIngestMs = 0;
    let totalEnrichMs = 0;
    let totalFinalizeMs = 0;
    let failedSourceEvent: RefreshEvent | null = null;

    for (const source of sources) {
      const sourceEvent = await runRefreshForSource(env, source, extractorMode, fetchDoc, llmEnricher);
      aggregate.sources_processed = (aggregate.sources_processed || 0) + 1;
      aggregate.parse_episodes = (aggregate.parse_episodes || 0) + (sourceEvent.parse_episodes || 0);
      aggregate.parse_chunks = (aggregate.parse_chunks || 0) + (sourceEvent.parse_chunks || 0);
      aggregate.new_episodes = (aggregate.new_episodes || 0) + (sourceEvent.new_episodes || 0);
      aggregate.new_chunks = (aggregate.new_chunks || 0) + (sourceEvent.new_chunks || 0);
      aggregate.enriched_chunks = (aggregate.enriched_chunks || 0) + (sourceEvent.enriched_chunks || 0);
      totalFetchMs += sourceEvent.fetch_ms || 0;
      totalParseMs += sourceEvent.parse_ms || 0;
      totalIngestMs += sourceEvent.ingest_ms || 0;
      totalEnrichMs += sourceEvent.enrich_ms || 0;
      totalFinalizeMs += sourceEvent.finalize_ms || 0;
      if (sourceEvent.status === "failed") {
        aggregate.sources_failed = (aggregate.sources_failed || 0) + 1;
        failedSourceEvent = failedSourceEvent || sourceEvent;
      }
    }

    aggregate.fetch_ms = totalFetchMs;
    aggregate.parse_ms = totalParseMs;
    aggregate.ingest_ms = totalIngestMs;
    aggregate.enrich_ms = totalEnrichMs;
    aggregate.finalize_ms = totalFinalizeMs;
    aggregate.status = (aggregate.sources_failed || 0) > 0 ? "failed" : "completed";
    if (failedSourceEvent) {
      aggregate.failed_step = failedSourceEvent.failed_step;
      aggregate.error = failedSourceEvent.error;
    }
    aggregate.duration_ms = elapsed(runStart);
    console.log(JSON.stringify(aggregate));
    return aggregate;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    aggregate.status = "failed";
    aggregate.failed_step = "load_sources";
    aggregate.error = msg.substring(0, 500);
    aggregate.duration_ms = elapsed(runStart);
    console.error(JSON.stringify(aggregate));
    return aggregate;
  }
}
