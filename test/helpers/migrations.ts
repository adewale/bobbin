import migration0001 from "../../migrations/0001_initial_schema.sql?raw";
import migration0002 from "../../migrations/0002_fts5_search.sql?raw";
import migration0003 from "../../migrations/0003_episode_format.sql?raw";
import migration0004 from "../../migrations/0004_concordance_distinctiveness.sql?raw";
import migration0005 from "../../migrations/0005_chunk_reach.sql?raw";
import migration0006 from "../../migrations/0006_performance_indexes.sql?raw";
import migration0007 from "../../migrations/0007_topics_rename.sql?raw";
import migration0008 from "../../migrations/0008_enriched_flag.sql?raw";
import migration0009 from "../../migrations/0009_enrichment_version.sql?raw";
import migration0010 from "../../migrations/0010_topic_pipeline_artifacts.sql?raw";
import migration0011 from "../../migrations/0011_word_stats_word_unique.sql?raw";
import migration0012 from "../../migrations/0012_topics_distinctiveness.sql?raw";
import migration0013 from "../../migrations/0013_ingestion_log_pipeline_report.sql?raw";
import migration0014 from "../../migrations/0014_pipeline_archives_and_stage_metrics.sql?raw";
import migration0015 from "../../migrations/0015_topic_lineage_archive_compaction.sql?raw";
import migration0016 from "../../migrations/0016_topic_lineage_archive_retroactive_compaction.sql?raw";
import migration0017 from "../../migrations/0017_source_fidelity_and_llm_ingest.sql?raw";
import migration0018 from "../../migrations/0018_large_artifact_chunks.sql?raw";
import migration0019 from "../../migrations/0019_chunk_footnotes.sql?raw";
import migration0020 from "../../migrations/0020_d1_best_practice_hardening.sql?raw";
import migration0021 from "../../migrations/0021_sources_activity_and_health.sql?raw";
import migration0022 from "../../migrations/0022_topic_similarity_and_incremental_finalize.sql?raw";

const DROPS = [
  "DROP TRIGGER IF EXISTS chunks_ai",
  "DROP TRIGGER IF EXISTS chunks_ad",
  "DROP TRIGGER IF EXISTS chunks_au",
  "DROP TABLE IF EXISTS chunks_fts",
  "DROP TABLE IF EXISTS episode_artifact_chunks",
  "DROP TABLE IF EXISTS source_html_chunks",
  "DROP TABLE IF EXISTS llm_episode_candidate_evidence",
  "DROP TABLE IF EXISTS llm_episode_candidates",
  "DROP TABLE IF EXISTS llm_enrichment_runs",
  "DROP TABLE IF EXISTS topic_similarity_scores",
  "DROP TABLE IF EXISTS topic_embedding_cache",
  "DROP TABLE IF EXISTS chunk_vector_cache",
  "DROP TABLE IF EXISTS topic_dirty",
  "DROP TABLE IF EXISTS pipeline_stage_metrics",
  "DROP TABLE IF EXISTS pipeline_runs",
  "DROP TABLE IF EXISTS topic_lineage_archive",
  "DROP TABLE IF EXISTS topic_merge_audit",
  "DROP TABLE IF EXISTS topic_candidate_audit",
  "DROP TABLE IF EXISTS phrase_lexicon",
  "DROP TABLE IF EXISTS chunk_words",
  "DROP TABLE IF EXISTS word_stats",
  "DROP TABLE IF EXISTS episode_topics",
  "DROP TABLE IF EXISTS chunk_topics",
  "DROP TABLE IF EXISTS topics",
  "DROP TABLE IF EXISTS episode_tags",
  "DROP TABLE IF EXISTS chunk_tags",
  "DROP TABLE IF EXISTS tags",
  "DROP TABLE IF EXISTS concordance",
  "DROP TABLE IF EXISTS chunks",
  "DROP TABLE IF EXISTS episodes",
  "DROP TABLE IF EXISTS ingestion_log",
  "DROP TABLE IF EXISTS sources",
];

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  const lines = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"));

  let current: string[] = [];
  let inTrigger = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) {
      inTrigger = true;
    }

    current.push(line);

    if (inTrigger) {
      if (/^END;$/i.test(trimmed)) {
        statements.push(current.join("\n").trim());
        current = [];
        inTrigger = false;
      }
      continue;
    }

    if (trimmed.endsWith(";")) {
      statements.push(current.join("\n").trim());
      current = [];
    }
  }

  if (current.length > 0) {
    statements.push(current.join("\n").trim());
  }

  return statements;
}

const MIGRATIONS = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
  migration0015,
  migration0016,
  migration0017,
  migration0018,
  migration0019,
  migration0020,
  migration0021,
  migration0022,
].flatMap(splitSqlStatements);

export async function applyTestMigrations(db: D1Database): Promise<void> {
  await db.batch(DROPS.map((sql) => db.prepare(sql)));

  for (const sql of MIGRATIONS) {
    await db.prepare(sql).run();
  }

  await db.prepare("PRAGMA optimize;").run();
}
