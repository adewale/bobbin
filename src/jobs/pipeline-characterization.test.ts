import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseHtmlDocument } from "../services/html-parser";
import { runPipelineCharacterization } from "./pipeline-characterization";

const RUN_CHARACTERIZATION = process.env.RUN_CHARACTERIZATION_TESTS === "1";
const MODE = process.env.PIPELINE_EXTRACTOR_MODE || "naive";

async function loadCharacterizationSources() {
  const [archiveEssaysHtml, archiveNotesHtml, currentHtml, emptyHtml] = await Promise.all([
    import("../../data/raw/1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html?raw"),
    import("../../data/raw/1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw.html?raw"),
    import("../../data/raw/1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA.html?raw"),
    import("../../data/raw/1x8z6k07JqXTVIRVNr1S_7wYVl5L7IpX14gXxU1UBrGk.html?raw"),
  ]);

  const archiveEssays = parseHtmlDocument(archiveEssaysHtml.default);
  const archiveNotes = parseHtmlDocument(archiveNotesHtml.default);
  const current = parseHtmlDocument(currentHtml.default);
  const empty = parseHtmlDocument(emptyHtml.default);

  return {
    characterizationSources: [
      {
        googleDocId: "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0",
        title: "Bits and Bobs (Archive Essays)",
        episodes: archiveEssays,
      },
      {
        googleDocId: "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw",
        title: "Bits and Bobs (Archive Notes)",
        episodes: archiveNotes,
      },
      {
        googleDocId: "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA",
        title: "Bits and Bobs (Current)",
        episodes: current,
      },
      {
        googleDocId: "1x8z6k07JqXTVIRVNr1S_7wYVl5L7IpX14gXxU1UBrGk",
        title: "Bits and Bobs (Empty)",
        episodes: empty,
      },
    ],
    regressionSources: [
      {
        googleDocId: "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0",
        title: "Bits and Bobs (Archive Essays)",
        episodes: archiveEssays.slice(0, 2),
      },
      {
        googleDocId: "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw",
        title: "Bits and Bobs (Archive Notes)",
        episodes: archiveNotes.slice(0, 3),
      },
      {
        googleDocId: "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA",
        title: "Bits and Bobs (Current)",
        episodes: current.slice(0, 2),
      },
    ],
  };
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe.skipIf(!RUN_CHARACTERIZATION)("pipeline characterization", () => {
  it(`captures full-corpus metrics for ${MODE}`, async () => {
    const { characterizationSources } = await loadCharacterizationSources();
    const metrics = await runPipelineCharacterization(env.DB, characterizationSources, MODE);

    expect(metrics.extractorMode).toBe(MODE === "yaket" || MODE === "yaket_bobbin" || MODE === "episode_hybrid" ? MODE : "naive");
    expect(metrics.sources).toBe(4);
    expect(metrics.episodes).toBe(80);
    expect(metrics.chunks).toBe(5771);
    expect(metrics.topicsActive).toBeGreaterThan(0);
    expect(metrics.topicsVisible).toBeGreaterThan(0);
    expect(metrics.candidateRows).toBeGreaterThan(metrics.candidatesAccepted);
    expect(metrics.candidatesRejected).toBeGreaterThan(0);
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
