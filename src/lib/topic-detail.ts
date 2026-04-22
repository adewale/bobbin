import { STOPWORDS } from "./text";

export interface RelatedTopicSummary {
  name: string;
  slug: string;
  co_count: number;
}

export interface TopicRankHistorySummary {
  year: number;
  count: number;
  rank: number;
}

export interface TopicAdjacentSummary {
  name: string;
  slug: string;
  usage_count: number;
  distinctiveness: number;
}

export interface TopicSummaryInput {
  topicName: string;
  totalChunks: number;
  totalEpisodes: number;
  firstPublishedDate?: string | null;
  lastPublishedDate?: string | null;
  peakEpisode?: {
    title: string;
    published_date: string;
    topic_chunk_count: number;
  } | null;
  relatedTopics: RelatedTopicSummary[];
  rankHistory: TopicRankHistorySummary[];
  aboveTopic?: TopicAdjacentSummary | null;
  belowTopic?: TopicAdjacentSummary | null;
}

export interface DriftTerm {
  word: string;
  earlyCount: number;
  lateCount: number;
  delta: number;
}

export function buildTopicSummary(input: TopicSummaryInput): string[] {
  const summary: string[] = [];

  if (input.firstPublishedDate && input.lastPublishedDate) {
    if (input.firstPublishedDate === input.lastPublishedDate) {
      summary.push(
        `${input.topicName} appears in ${input.totalChunks} chunk${input.totalChunks === 1 ? "" : "s"} from ${input.firstPublishedDate}.`
      );
    } else {
      summary.push(
        `${input.topicName} appears in ${input.totalChunks} chunk${input.totalChunks === 1 ? "" : "s"} across ${input.totalEpisodes} episode${input.totalEpisodes === 1 ? "" : "s"}, from ${input.firstPublishedDate} to ${input.lastPublishedDate}.`
      );
    }
  }

  if (input.peakEpisode) {
    summary.push(
      `Its densest episode is ${input.peakEpisode.title} (${input.peakEpisode.published_date}), with ${input.peakEpisode.topic_chunk_count} observation${input.peakEpisode.topic_chunk_count === 1 ? "" : "s"} on this topic.`
    );
  }

  if (input.relatedTopics.length > 0) {
    summary.push(`It most often travels with ${formatList(input.relatedTopics.slice(0, 3).map((topic) => topic.name))}.`);
  }

  const rankStart = input.rankHistory[0];
  const rankEnd = input.rankHistory[input.rankHistory.length - 1];
  const neighbors = [input.aboveTopic?.name, input.belowTopic?.name].filter(Boolean) as string[];

  if (rankStart && rankEnd && rankStart.year !== rankEnd.year && neighbors.length > 0) {
    summary.push(
      `By chunk count it sits near ${formatList(neighbors)}; its yearly rank moved from #${rankStart.rank} in ${rankStart.year} to #${rankEnd.rank} in ${rankEnd.year}.`
    );
  } else if (rankStart && rankEnd && rankStart.year !== rankEnd.year) {
    summary.push(`Its yearly rank moved from #${rankStart.rank} in ${rankStart.year} to #${rankEnd.rank} in ${rankEnd.year}.`);
  } else if (neighbors.length > 0) {
    summary.push(`By chunk count it sits near ${formatList(neighbors)}.`);
  }

  return summary.slice(0, 3);
}

export function buildTerminologyDrift(chunks: Array<{ content_plain: string }>, topicName: string, limit = 5) {
  if (chunks.length < 2) {
    return { earlier: [] as DriftTerm[], later: [] as DriftTerm[] };
  }

  const splitIndex = Math.ceil(chunks.length / 2);
  const early = chunks.slice(0, splitIndex);
  const late = chunks.slice(splitIndex);

  if (early.length === 0 || late.length === 0) {
    return { earlier: [] as DriftTerm[], later: [] as DriftTerm[] };
  }

  const topicTokens = extractTopicTokens(topicName);
  const earlyCounts = countTerms(early, topicTokens);
  const lateCounts = countTerms(late, topicTokens);
  const allWords = new Set([...earlyCounts.keys(), ...lateCounts.keys()]);
  const earlyTotal = totalCounts(earlyCounts);
  const lateTotal = totalCounts(lateCounts);

  const changes = [...allWords]
    .map((word) => {
      const earlyCount = earlyCounts.get(word) ?? 0;
      const lateCount = lateCounts.get(word) ?? 0;
      const earlyShare = earlyCount / Math.max(earlyTotal, 1);
      const lateShare = lateCount / Math.max(lateTotal, 1);

      return {
        word,
        earlyCount,
        lateCount,
        delta: lateShare - earlyShare,
      };
    })
    .filter((term) => term.earlyCount > 0 || term.lateCount > 0);

  const earlier = changes
    .filter((term) => term.earlyCount > 0 && term.delta < 0)
    .sort((left, right) => (left.delta - right.delta) || (right.earlyCount - left.earlyCount) || left.word.localeCompare(right.word))
    .slice(0, limit);

  const later = changes
    .filter((term) => term.lateCount > 0 && term.delta > 0)
    .sort((left, right) => (right.delta - left.delta) || (right.lateCount - left.lateCount) || left.word.localeCompare(right.word))
    .slice(0, limit);

  return { earlier, later };
}

function countTerms(chunks: Array<{ content_plain: string }>, topicTokens: Set<string>) {
  const counts = new Map<string, number>();

  for (const chunk of chunks) {
    for (const word of tokenizeDriftText(chunk.content_plain, topicTokens)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return counts;
}

function tokenizeDriftText(text: string, topicTokens: Set<string>) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !STOPWORDS.has(word))
    .filter((word) => !topicTokens.has(word));
}

function extractTopicTokens(topicName: string) {
  return new Set(
    topicName
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

function totalCounts(counts: Map<string, number>) {
  return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

function formatList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
