// Deterministic template-driven summary for a period.
//
// Modelled exactly on `buildTopicSummary` in `src/lib/topic-detail.ts`:
// each sentence is a fixed template populated from named observable
// inputs (counts, names, dates, ratios). No interpretation, no LLM, no
// editorial verbs — every word is either fixed UI text or a value from
// the input object.
//
// To audit an implementation: read the templates below; any sentence
// that appears in rendered HTML must match one of them with values
// substituted. If a sentence cannot be derived from the templates, it
// is a spec violation.

export interface PeriodSummaryInput {
  periodLabel: string;          // "April 2026" or "2026"
  episodeCount: number;
  chunkCount: number;
  firstPublishedDate?: string;  // ISO YYYY-MM-DD
  lastPublishedDate?: string;
  topByMentions?: { name: string; chunkCount: number };
  newTopicCount: number;
  topNewTopic?: { name: string; chunkCount: number };
  intensifiedCount: number;
  downshiftedCount: number;
  topContrast?: { name: string; spikeRatio: number };
}

function plural(n: number, singular: string, pl?: string): string {
  return n === 1 ? singular : (pl ?? `${singular}s`);
}

export function buildPeriodSummary(input: PeriodSummaryInput): string[] {
  const out: string[] = [];

  // Span sentence — always first when there is data.
  if (input.episodeCount > 0 && input.firstPublishedDate && input.lastPublishedDate) {
    const epWord = plural(input.episodeCount, "episode");
    const chWord = plural(input.chunkCount, "chunk");
    if (input.firstPublishedDate === input.lastPublishedDate) {
      out.push(
        `${input.periodLabel} contains ${input.episodeCount} ${epWord} and ${input.chunkCount} ${chWord}, on ${input.firstPublishedDate}.`,
      );
    } else {
      out.push(
        `${input.periodLabel} contains ${input.episodeCount} ${epWord} and ${input.chunkCount} ${chWord}, from ${input.firstPublishedDate} to ${input.lastPublishedDate}.`,
      );
    }
  }

  // Most-mentioned topic in the period.
  if (input.topByMentions && input.topByMentions.chunkCount > 0) {
    const chWord = plural(input.topByMentions.chunkCount, "chunk");
    out.push(
      `Most-mentioned topic: ${input.topByMentions.name} (${input.topByMentions.chunkCount} ${chWord}).`,
    );
  }

  // First-appearance summary.
  if (input.newTopicCount > 0 && input.topNewTopic) {
    if (input.newTopicCount === 1) {
      out.push(`One topic first appears in this period: ${input.topNewTopic.name}.`);
    } else {
      const chWord = plural(input.topNewTopic.chunkCount, "chunk");
      out.push(
        `${input.newTopicCount} topics first appear in this period; the most-mentioned is ${input.topNewTopic.name} (${input.topNewTopic.chunkCount} ${chWord}).`,
      );
    }
  }

  // Movers count vs previous period.
  if (input.intensifiedCount > 0 && input.downshiftedCount > 0) {
    out.push(
      `${input.intensifiedCount} ${plural(input.intensifiedCount, "topic")} intensified vs the previous period; ${input.downshiftedCount} declined.`,
    );
  } else if (input.intensifiedCount > 0) {
    out.push(
      `${input.intensifiedCount} ${plural(input.intensifiedCount, "topic")} intensified vs the previous period.`,
    );
  } else if (input.downshiftedCount > 0) {
    out.push(
      `${input.downshiftedCount} ${plural(input.downshiftedCount, "topic")} declined vs the previous period.`,
    );
  }

  // Archive contrast leader.
  if (input.topContrast && input.topContrast.spikeRatio > 1.5) {
    out.push(
      `Most over-indexed vs corpus: ${input.topContrast.name} (${input.topContrast.spikeRatio.toFixed(1)}× typical).`,
    );
  }

  return out.slice(0, 5);
}
