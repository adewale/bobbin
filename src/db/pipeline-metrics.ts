import type { IngestionRunType } from "./ingestion";
import type { TopicExtractorMode } from "../services/yake-runtime";

export interface PipelineRunSummary {
  sourceId?: number | null;
  runType: IngestionRunType;
  extractorMode: TopicExtractorMode;
  status: "completed" | "partial" | "failed";
  totalMs: number;
  chunksProcessed: number;
  candidatesGenerated: number;
  candidatesRejectedEarly: number;
  candidatesInserted: number;
  topicsInserted: number;
  chunkTopicLinksInserted: number;
  chunkWordRowsInserted: number;
  pruned: number;
  merged: number;
  orphanTopicsDeleted: number;
  archivedLineageTopics: number;
}

export interface StageMetricRow {
  phase: string;
  name: string;
  duration_ms: number;
  status: "ok" | "error";
  counts: Record<string, number>;
  detail?: string;
}

export async function recordPipelineRun(
  db: D1Database,
  ingestionLogId: number,
  summary: PipelineRunSummary,
  stages: StageMetricRow[]
): Promise<number> {
  const runResult = await db.prepare(
    `INSERT INTO pipeline_runs (
       ingestion_log_id, source_id, run_type, extractor_mode, status, total_ms,
       chunks_processed, candidates_generated, candidates_rejected_early, candidates_inserted,
       topics_inserted, chunk_topic_links_inserted, chunk_word_rows_inserted,
       pruned, merged, orphan_topics_deleted, archived_lineage_topics
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ingestionLogId,
    summary.sourceId ?? null,
    summary.runType,
    summary.extractorMode,
    summary.status,
    summary.totalMs,
    summary.chunksProcessed,
    summary.candidatesGenerated,
    summary.candidatesRejectedEarly,
    summary.candidatesInserted,
    summary.topicsInserted,
    summary.chunkTopicLinksInserted,
    summary.chunkWordRowsInserted,
    summary.pruned,
    summary.merged,
    summary.orphanTopicsDeleted,
    summary.archivedLineageTopics,
  ).run();

  const pipelineRunId = Number(runResult.meta.last_row_id);
  if (stages.length === 0) return pipelineRunId;

  await db.batch(stages.map((stage, index) =>
    db.prepare(
      `INSERT INTO pipeline_stage_metrics (
         pipeline_run_id, phase, stage_name, stage_order, status, duration_ms, counts_json, detail
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      pipelineRunId,
      stage.phase,
      stage.name,
      index,
      stage.status,
      stage.duration_ms,
      JSON.stringify(stage.counts || {}),
      stage.detail ?? null,
    )
  ));

  return pipelineRunId;
}
