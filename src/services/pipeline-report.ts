import type { IngestionRunType } from "../db/ingestion";
import type { PipelineRunSummary, StageMetricRow } from "../db/pipeline-metrics";
import type { FinalizeResult, FinalizeStep, ProcessChunkBatchResult, PipelineStageResult } from "../jobs/ingest";
import type { TopicExtractorMode } from "./yake-runtime";

function mergeStageCounts(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + value;
  }
}

function rollupStages(
  phase: string,
  stages: Array<PipelineStageResult | FinalizeStep>
): StageMetricRow[] {
  const byName = new Map<string, StageMetricRow>();
  for (const stage of stages) {
    const existing = byName.get(stage.name);
    if (!existing) {
      byName.set(stage.name, {
        phase,
        name: stage.name,
        duration_ms: stage.duration_ms,
        status: stage.status,
        counts: { ...(stage.counts || {}) },
        ...(stage.detail ? { detail: stage.detail } : {}),
      });
      continue;
    }

    existing.duration_ms += stage.duration_ms;
    existing.status = existing.status === "error" || stage.status === "error" ? "error" : "ok";
    mergeStageCounts(existing.counts, stage.counts || {});
    if (!existing.detail && stage.detail) {
      existing.detail = stage.detail;
    }
  }

  return [...byName.values()];
}

export function summarizeEnrichBatches(
  runType: IngestionRunType,
  extractorMode: TopicExtractorMode,
  batches: ProcessChunkBatchResult[],
  sourceId?: number | null,
): { summary: PipelineRunSummary; stages: StageMetricRow[] } {
  const summary: PipelineRunSummary = {
    sourceId,
    runType,
    extractorMode,
    status: "completed",
    totalMs: 0,
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
  };

  const allStages: PipelineStageResult[] = [];
  for (const batch of batches) {
    summary.chunksProcessed += batch.chunksProcessed;
    summary.candidatesGenerated += batch.candidatesGenerated;
    summary.candidatesRejectedEarly += batch.candidatesRejectedEarly;
    summary.candidatesInserted += batch.candidatesInserted;
    summary.topicsInserted += batch.topicsInserted;
    summary.chunkTopicLinksInserted += batch.chunkTopicLinksInserted;
    summary.chunkWordRowsInserted += batch.chunkWordRowsInserted;
    summary.totalMs += batch.stageResults.reduce((sum, stage) => sum + stage.duration_ms, 0);
    allStages.push(...batch.stageResults);
  }

  return {
    summary,
    stages: rollupStages("enrich", allStages),
  };
}

export function summarizeFinalizeResult(
  runType: IngestionRunType,
  extractorMode: TopicExtractorMode,
  finalize: FinalizeResult,
  sourceId?: number | null,
): { summary: PipelineRunSummary; stages: StageMetricRow[] } {
  const failedSteps = finalize.steps.filter((step) => step.status === "error");
  return {
    summary: {
      sourceId,
      runType,
      extractorMode,
      status: failedSteps.length > 0 ? "partial" : "completed",
      totalMs: finalize.total_ms,
      chunksProcessed: 0,
      candidatesGenerated: 0,
      candidatesRejectedEarly: 0,
      candidatesInserted: 0,
      topicsInserted: 0,
      chunkTopicLinksInserted: 0,
      chunkWordRowsInserted: 0,
      pruned: finalize.pruned,
      merged: finalize.merged,
      orphanTopicsDeleted: finalize.orphan_topics_deleted,
      archivedLineageTopics: finalize.archived_lineage_topics,
    },
    stages: rollupStages("finalize", finalize.steps),
  };
}

export function combinePipelineReports(
  runType: IngestionRunType,
  extractorMode: TopicExtractorMode,
  enrichBatches: ProcessChunkBatchResult[],
  finalize?: FinalizeResult,
  sourceId?: number | null,
): { summary: PipelineRunSummary; stages: StageMetricRow[] } {
  const enrich = summarizeEnrichBatches(runType, extractorMode, enrichBatches, sourceId);
  if (!finalize) {
    return enrich;
  }

  const final = summarizeFinalizeResult(runType, extractorMode, finalize, sourceId);
  return {
    summary: {
      ...enrich.summary,
      status: final.summary.status,
      totalMs: enrich.summary.totalMs + final.summary.totalMs,
      pruned: final.summary.pruned,
      merged: final.summary.merged,
      orphanTopicsDeleted: final.summary.orphanTopicsDeleted,
      archivedLineageTopics: final.summary.archivedLineageTopics,
    },
    stages: [...enrich.stages, ...final.stages],
  };
}
