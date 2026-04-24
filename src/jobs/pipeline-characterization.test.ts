import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseHtmlDocument } from "../services/html-parser";
import { runPipelineCharacterization } from "./pipeline-characterization";
import sampleEssaysHtml from "../../test/fixtures/sample-mobilebasic.html?raw";
import sampleNotesHtml from "../../test/fixtures/sample-notes-format.html?raw";

const MODE = process.env.PIPELINE_EXTRACTOR_MODE || "naive";

async function loadCharacterizationSources() {
  const essays = parseHtmlDocument(sampleEssaysHtml);
  const notes = parseHtmlDocument(sampleNotesHtml);
  const empty: ReturnType<typeof parseHtmlDocument> = [];

  return {
    characterizationSources: [
      {
        googleDocId: "sample-essays",
        title: "Bits and Bobs (Sample Essays)",
        episodes: essays.slice(0, 2),
      },
      {
        googleDocId: "sample-notes",
        title: "Bits and Bobs (Sample Notes)",
        episodes: notes.slice(0, 2),
      },
      {
        googleDocId: "sample-empty",
        title: "Bits and Bobs (Empty)",
        episodes: empty,
      },
    ],
    regressionSources: [
      {
        googleDocId: "sample-essays",
        title: "Bits and Bobs (Sample Essays)",
        episodes: essays.slice(0, 2),
      },
      {
        googleDocId: "sample-notes",
        title: "Bits and Bobs (Sample Notes)",
        episodes: notes.slice(0, 2),
      },
    ],
  };
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("pipeline characterization", () => {
  it(`captures representative pipeline metrics for ${MODE}`, async () => {
    const { characterizationSources } = await loadCharacterizationSources();
    const metrics = await runPipelineCharacterization(env.DB, characterizationSources, MODE);

    expect(metrics.extractorMode).toBe(MODE === "yaket" || MODE === "yaket_bobbin" || MODE === "episode_hybrid" ? MODE : "naive");
    expect(metrics.sources).toBe(3);
    expect(metrics.episodes).toBe(3);
    expect(metrics.chunks).toBeGreaterThan(10);
    expect(metrics.topicsActive).toBeGreaterThanOrEqual(0);
    expect(metrics.topicsVisible).toBeLessThanOrEqual(metrics.topicsActive);
    expect(metrics.candidateRows).toBeGreaterThanOrEqual(metrics.candidatesAccepted);
    expect(metrics.candidatesRejected).toBeGreaterThanOrEqual(0);
    expect(metrics.activeTopicsWithProvenance).toBe(metrics.topicsActive);
    expect(metrics.archivedLineageTopics).toBeGreaterThanOrEqual(0);
    expect(metrics.finalize.archived_lineage_topics).toBe(metrics.archivedLineageTopics);

    console.log(`PIPELINE_CHARACTERIZATION ${JSON.stringify(metrics)}`);
  }, 300000);
  it("bobbin-tuned Yaket reduces weak visible singletons without hurting entity coverage on a representative slice", async () => {
    const { regressionSources } = await loadCharacterizationSources();
    const baseline = await runPipelineCharacterization(env.DB, regressionSources, "yaket");

    await applyTestMigrations(env.DB);

    const tuned = await runPipelineCharacterization(env.DB, regressionSources, "yaket_bobbin");

    expect(tuned.extractorMode).toBe("yaket_bobbin");
    expect(tuned.weakVisibleSingletons).toBeLessThanOrEqual(baseline.weakVisibleSingletons);
    expect(tuned.topicsVisible).toBeLessThanOrEqual(baseline.topicsVisible);
    expect(tuned.activeTopicsWithProvenance).toBe(tuned.topicsActive);

    const baselineEntities = new Map(baseline.keyEntities.map((row) => [row.slug, row.usage_count]));
    const tunedEntities = new Map(tuned.keyEntities.map((row) => [row.slug, row.usage_count]));
    for (const [slug, usage] of baselineEntities) {
      if (usage > 0) {
        expect(tunedEntities.get(slug) ?? 0).toBeGreaterThanOrEqual(usage);
      }
    }
  }, 120000);
});
