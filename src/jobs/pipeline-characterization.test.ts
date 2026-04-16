import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseHtmlDocument } from "../services/html-parser";
import { runPipelineCharacterization } from "./pipeline-characterization";
import archiveEssaysHtml from "../../data/raw/1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0.html?raw";
import archiveNotesHtml from "../../data/raw/1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw.html?raw";
import currentHtml from "../../data/raw/1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA.html?raw";
import emptyHtml from "../../data/raw/1x8z6k07JqXTVIRVNr1S_7wYVl5L7IpX14gXxU1UBrGk.html?raw";

const RUN_CHARACTERIZATION = process.env.RUN_CHARACTERIZATION_TESTS === "1";
const MODE = process.env.PIPELINE_EXTRACTOR_MODE || "naive";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe.skipIf(!RUN_CHARACTERIZATION)("pipeline characterization", () => {
  it(`captures full-corpus metrics for ${MODE}`, async () => {
    const metrics = await runPipelineCharacterization(env.DB, [
      {
        googleDocId: "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0",
        title: "Bits and Bobs (Archive Essays)",
        episodes: parseHtmlDocument(archiveEssaysHtml),
      },
      {
        googleDocId: "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw",
        title: "Bits and Bobs (Archive Notes)",
        episodes: parseHtmlDocument(archiveNotesHtml),
      },
      {
        googleDocId: "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA",
        title: "Bits and Bobs (Current)",
        episodes: parseHtmlDocument(currentHtml),
      },
      {
        googleDocId: "1x8z6k07JqXTVIRVNr1S_7wYVl5L7IpX14gXxU1UBrGk",
        title: "Bits and Bobs (Empty)",
        episodes: parseHtmlDocument(emptyHtml),
      },
    ], MODE);

    expect(metrics.extractorMode).toBe(MODE === "yaket" ? "yaket" : "naive");
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
});
