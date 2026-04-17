import { isNoiseTopic, isWeakSingletonTopic } from "./topic-quality";

export interface CandidatePromotionStats {
  chunkSupport: number;
  episodeSupport: number;
  existingUsageCount: number;
  wordDistinctiveness: number;
}

export interface PhrasePromotionStats {
  docCount: number;
  supportCount: number;
  qualityScore: number;
  normalizedName: string;
}

export interface DisplayTopicStats {
  name: string;
  kind?: string;
  usage_count: number;
  distinctiveness: number;
  episode_support?: number;
}

export const PIPELINE_TUNING = {
  minNonEntityChunkSupport: 5,
  minNonEntityEpisodeSupport: 2,
  minPhraseChunkSupport: 4,
  minPhraseEpisodeSupport: 2,
  minSingletonDistinctiveness: 20,
  minPhraseLexiconDocCount: 2,
  minPhraseLexiconSupport: 2,
  minPhraseLexiconQualityScore: 1.5,
  minVisibleEpisodeSupport: 2,
  minVisibleSingletonDistinctiveness: 25,
  minVisibleSingletonUsage: 10,
} as const;

export function getPhrasePromotionReason(stats: PhrasePromotionStats): string | null {
  if (isNoiseTopic(stats.normalizedName)) return "noise_phrase";
  if (stats.docCount < PIPELINE_TUNING.minPhraseLexiconDocCount) return "low_doc_count";
  if (stats.supportCount < PIPELINE_TUNING.minPhraseLexiconSupport) return "low_support_count";
  if (stats.qualityScore < PIPELINE_TUNING.minPhraseLexiconQualityScore) return "low_quality_score";
  return null;
}

export function getCorpusPriorRejectionReason(
  candidate: { kind: string; normalizedCandidate: string },
  stats: CandidatePromotionStats,
): string | null {
  const words = candidate.normalizedCandidate.split(/\s+/).filter(Boolean);
  if (candidate.kind === "entity" || words.length !== 1) return null;
  if (isWeakSingletonTopic(candidate.normalizedCandidate, stats.chunkSupport, stats.wordDistinctiveness)) {
    return "weak_singleton_prior";
  }
  if (stats.wordDistinctiveness < PIPELINE_TUNING.minSingletonDistinctiveness && stats.existingUsageCount < 5) {
    return "low_distinctiveness_prior";
  }
  return null;
}

export function getCandidatePromotionReason(
  candidate: { kind: string; normalizedCandidate: string },
  stats: CandidatePromotionStats,
): string | null {
  if (candidate.kind === "entity") return null;

  const words = candidate.normalizedCandidate.split(/\s+/).filter(Boolean);
  const minChunkSupport = words.length > 1
    ? PIPELINE_TUNING.minPhraseChunkSupport
    : PIPELINE_TUNING.minNonEntityChunkSupport;
  const minEpisodeSupport = words.length > 1
    ? PIPELINE_TUNING.minPhraseEpisodeSupport
    : PIPELINE_TUNING.minNonEntityEpisodeSupport;

  if (stats.episodeSupport < minEpisodeSupport) return "insufficient_episode_support";
  if (stats.chunkSupport < minChunkSupport) return "insufficient_chunk_support";
  if (words.length === 1 && stats.wordDistinctiveness < PIPELINE_TUNING.minSingletonDistinctiveness && stats.existingUsageCount < 8) {
    return "low_distinctiveness_support";
  }

  return null;
}

export function getDisplaySuppressionReason(topic: DisplayTopicStats): string | null {
  const lower = topic.name.toLowerCase();
  if (topic.kind === "entity") return null;
  if ((topic.episode_support ?? 0) < PIPELINE_TUNING.minVisibleEpisodeSupport) return "low_episode_spread";
  if (!lower.includes(" ") && topic.usage_count < PIPELINE_TUNING.minVisibleSingletonUsage && topic.distinctiveness < PIPELINE_TUNING.minVisibleSingletonDistinctiveness) {
    return "weak_singleton_filter";
  }
  return null;
}
