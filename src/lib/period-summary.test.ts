import { describe, expect, it } from "vitest";
import { buildPeriodSummary } from "./period-summary";

// These tests pin the exact template output for given inputs. If a sentence
// in the rendered HTML cannot be reproduced by a test below with appropriate
// inputs, it is a spec violation.

describe("buildPeriodSummary", () => {
  it("produces no sentences for an empty period", () => {
    expect(buildPeriodSummary({
      periodLabel: "April 2026",
      episodeCount: 0,
      chunkCount: 0,
      newTopicCount: 0,
      intensifiedCount: 0,
      downshiftedCount: 0,
    })).toEqual([]);
  });

  it("renders a span sentence with date range and pluralised counts", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2026",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2026-04-06",
      lastPublishedDate: "2026-04-27",
      newTopicCount: 0,
      intensifiedCount: 0,
      downshiftedCount: 0,
    });
    expect(out[0]).toBe(
      "April 2026 contains 4 episodes and 287 chunks, from 2026-04-06 to 2026-04-27.",
    );
  });

  it("collapses the span sentence when first and last date match", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2026",
      episodeCount: 1,
      chunkCount: 71,
      firstPublishedDate: "2026-04-06",
      lastPublishedDate: "2026-04-06",
      newTopicCount: 0,
      intensifiedCount: 0,
      downshiftedCount: 0,
    });
    expect(out[0]).toBe("April 2026 contains 1 episode and 71 chunks, on 2026-04-06.");
  });

  it("singularises 'episode' and 'chunk' when count is 1", () => {
    const out = buildPeriodSummary({
      periodLabel: "December 2024",
      episodeCount: 1,
      chunkCount: 1,
      firstPublishedDate: "2024-12-09",
      lastPublishedDate: "2024-12-09",
      newTopicCount: 0,
      intensifiedCount: 0,
      downshiftedCount: 0,
    });
    expect(out[0]).toBe("December 2024 contains 1 episode and 1 chunk, on 2024-12-09.");
  });

  it("emits the most-mentioned-topic sentence when topByMentions is provided", () => {
    const out = buildPeriodSummary({
      periodLabel: "2025",
      episodeCount: 51,
      chunkCount: 3617,
      firstPublishedDate: "2025-01-06",
      lastPublishedDate: "2025-12-29",
      topByMentions: { name: "agent", chunkCount: 184 },
      newTopicCount: 0,
      intensifiedCount: 0,
      downshiftedCount: 0,
    });
    expect(out).toContain("Most-mentioned topic: agent (184 chunks).");
  });

  it("renders the new-topic sentence with the most-mentioned new entry when there are multiple", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      newTopicCount: 5,
      topNewTopic: { name: "vibe coding", chunkCount: 8 },
      intensifiedCount: 0,
      downshiftedCount: 0,
    });
    expect(out).toContain(
      "5 topics first appear in this period; the most-mentioned is vibe coding (8 chunks).",
    );
  });

  it("renders the singular new-topic sentence when only one topic is new", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      newTopicCount: 1,
      topNewTopic: { name: "vibe coding", chunkCount: 8 },
      intensifiedCount: 0,
      downshiftedCount: 0,
    });
    expect(out).toContain("One topic first appears in this period: vibe coding.");
  });

  it("combines intensified and declined counts into one sentence", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      newTopicCount: 0,
      intensifiedCount: 3,
      downshiftedCount: 2,
    });
    expect(out).toContain("3 topics intensified vs the previous period; 2 declined.");
  });

  it("renders only the intensified sentence when nothing declined", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      newTopicCount: 0,
      intensifiedCount: 3,
      downshiftedCount: 0,
    });
    expect(out).toContain("3 topics intensified vs the previous period.");
    expect(out.some((line) => line.includes("declined"))).toBe(false);
  });

  it("singularises 'topic' in the movers sentence", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      newTopicCount: 0,
      intensifiedCount: 1,
      downshiftedCount: 0,
    });
    expect(out).toContain("1 topic intensified vs the previous period.");
  });

  it("renders the archive-contrast leader sentence with one decimal place", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      newTopicCount: 0,
      intensifiedCount: 0,
      downshiftedCount: 0,
      topContrast: { name: "vibe coding", spikeRatio: 3.42 },
    });
    expect(out).toContain("Most over-indexed vs corpus: vibe coding (3.4× typical).");
  });

  it("omits archive-contrast leader when spikeRatio is at or below 1.5", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      newTopicCount: 0,
      intensifiedCount: 0,
      downshiftedCount: 0,
      topContrast: { name: "agent", spikeRatio: 1.5 },
    });
    expect(out.some((line) => line.includes("over-indexed"))).toBe(false);
  });

  it("caps output at five sentences even when every input is provided", () => {
    const out = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      topByMentions: { name: "agent", chunkCount: 12 },
      newTopicCount: 5,
      topNewTopic: { name: "vibe coding", chunkCount: 8 },
      intensifiedCount: 3,
      downshiftedCount: 2,
      topContrast: { name: "vibe coding", spikeRatio: 3.4 },
    });
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("never invents content beyond what the inputs supply", () => {
    // No interpretive verbs, no proper nouns not in inputs, no domain claims.
    // We assert that every sentence either contains the periodLabel or one of
    // the named entities passed in.
    const input = {
      periodLabel: "April 2025",
      episodeCount: 4,
      chunkCount: 287,
      firstPublishedDate: "2025-04-06",
      lastPublishedDate: "2025-04-27",
      topByMentions: { name: "agent", chunkCount: 12 },
      newTopicCount: 5,
      topNewTopic: { name: "vibe coding", chunkCount: 8 },
      intensifiedCount: 3,
      downshiftedCount: 2,
      topContrast: { name: "swarm", spikeRatio: 3.4 },
    };
    const out = buildPeriodSummary(input);
    const names = [
      input.periodLabel,
      input.topByMentions.name,
      input.topNewTopic.name,
      input.topContrast.name,
    ];
    for (const sentence of out) {
      const hasNamed = names.some((n) => sentence.includes(n));
      const isCountSentence = /vs the previous period/.test(sentence);
      // Every sentence must either name a passed-in entity, mention the
      // period label, or be the count-only movers sentence.
      expect(hasNamed || isCountSentence).toBe(true);
    }
  });
});
