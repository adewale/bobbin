import { ingestEpisodesOnly, enrichAllChunks, finalizeEnrichment } from "./ingest";
import { normalizeTopicExtractorMode, type TopicExtractorMode } from "../services/yake-runtime";

export interface CharacterizationSource {
  googleDocId: string;
  title: string;
  episodes: import("../types").ParsedEpisode[];
}

export interface PipelineCharacterizationMetrics {
  extractorMode: TopicExtractorMode;
  sources: number;
  episodes: number;
  chunks: number;
  topicsTotal: number;
  topicsActive: number;
  topicsVisible: number;
  activeEntities: number;
  activePhrases: number;
  suppressedActiveTopics: number;
  weakVisibleSingletons: number;
  archivedLineageTopics: number;
  candidateRows: number;
  candidatesAccepted: number;
  candidatesRejected: number;
  phraseLexiconRows: number;
  mergeRows: number;
  chunkTopicLinks: number;
  chunkWordRows: number;
  activeTopicsWithProvenance: number;
  topVisibleTopics: { name: string; slug: string; usage_count: number }[];
  keyEntities: { slug: string; usage_count: number }[];
  finalize: import("./ingest").FinalizeResult;
}

export async function runPipelineCharacterization(
  db: D1Database,
  sources: CharacterizationSource[],
  extractorModeInput: string | null | undefined,
): Promise<PipelineCharacterizationMetrics> {
  const extractorMode = normalizeTopicExtractorMode(extractorModeInput);

  for (const source of sources) {
    const sourceResult = await db.prepare(
      "INSERT INTO sources (google_doc_id, title) VALUES (?, ?)"
    ).bind(source.googleDocId, source.title).run();

    await ingestEpisodesOnly(db, Number(sourceResult.meta.last_row_id), source.episodes);
  }

  await enrichAllChunks(db, 200, 300000, undefined, extractorMode);
  const finalize = await finalizeEnrichment(db);

  const summary = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM sources) AS sources,
       (SELECT COUNT(*) FROM episodes) AS episodes,
       (SELECT COUNT(*) FROM chunks) AS chunks,
       (SELECT COUNT(*) FROM topics) AS topics_total,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0) AS topics_active,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND hidden = 0 AND display_suppressed = 0) AS topics_visible,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND kind = 'entity') AS active_entities,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND kind = 'phrase') AS active_phrases,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND display_suppressed = 1) AS suppressed_active_topics,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND hidden = 0 AND display_suppressed = 0 AND kind != 'entity' AND name NOT LIKE '% %' AND distinctiveness < 20) AS weak_visible_singletons,
       (SELECT COUNT(*) FROM topic_lineage_archive) AS archived_lineage_topics,
       (SELECT COUNT(*) FROM topic_candidate_audit) AS candidate_rows,
       (SELECT COUNT(*) FROM topic_candidate_audit WHERE decision = 'accepted') AS candidates_accepted,
       (SELECT COUNT(*) FROM topic_candidate_audit WHERE decision = 'rejected') AS candidates_rejected,
       (SELECT COUNT(*) FROM phrase_lexicon) AS phrase_lexicon_rows,
       (SELECT COUNT(*) FROM topic_merge_audit) AS merge_rows,
       (SELECT COUNT(*) FROM chunk_topics) AS chunk_topic_links,
       (SELECT COUNT(*) FROM chunk_words) AS chunk_word_rows,
       (SELECT COUNT(*) FROM topics WHERE usage_count > 0 AND provenance_complete = 1) AS active_topics_with_provenance`
  ).first<{
    sources: number;
    episodes: number;
    chunks: number;
    topics_total: number;
    topics_active: number;
    topics_visible: number;
    active_entities: number;
    active_phrases: number;
    suppressed_active_topics: number;
    weak_visible_singletons: number;
    archived_lineage_topics: number;
    candidate_rows: number;
    candidates_accepted: number;
    candidates_rejected: number;
    phrase_lexicon_rows: number;
    merge_rows: number;
    chunk_topic_links: number;
    chunk_word_rows: number;
    active_topics_with_provenance: number;
  }>();

  const topVisibleTopics = await db.prepare(
    `SELECT name, slug, usage_count
     FROM topics
     WHERE usage_count > 0 AND hidden = 0 AND display_suppressed = 0
     ORDER BY usage_count DESC, distinctiveness DESC, name ASC
     LIMIT 15`
  ).all<{ name: string; slug: string; usage_count: number }>();

  const keyEntities = await db.prepare(
    `SELECT slug, usage_count
     FROM topics
     WHERE slug IN ('openai','chatgpt','claude','claude-code','anthropic','google','meta','microsoft','apple')
     ORDER BY slug ASC`
  ).all<{ slug: string; usage_count: number }>();

  return {
    extractorMode,
    sources: summary?.sources || 0,
    episodes: summary?.episodes || 0,
    chunks: summary?.chunks || 0,
    topicsTotal: summary?.topics_total || 0,
    topicsActive: summary?.topics_active || 0,
    topicsVisible: summary?.topics_visible || 0,
    activeEntities: summary?.active_entities || 0,
    activePhrases: summary?.active_phrases || 0,
    suppressedActiveTopics: summary?.suppressed_active_topics || 0,
    weakVisibleSingletons: summary?.weak_visible_singletons || 0,
    archivedLineageTopics: summary?.archived_lineage_topics || 0,
    candidateRows: summary?.candidate_rows || 0,
    candidatesAccepted: summary?.candidates_accepted || 0,
    candidatesRejected: summary?.candidates_rejected || 0,
    phraseLexiconRows: summary?.phrase_lexicon_rows || 0,
    mergeRows: summary?.merge_rows || 0,
    chunkTopicLinks: summary?.chunk_topic_links || 0,
    chunkWordRows: summary?.chunk_word_rows || 0,
    activeTopicsWithProvenance: summary?.active_topics_with_provenance || 0,
    topVisibleTopics: topVisibleTopics.results,
    keyEntities: keyEntities.results,
    finalize,
  };
}
