import { beforeEach, describe, expect, it } from "vitest";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { env } from "cloudflare:test";
import { parseHtmlDocument } from "../services/html-parser";
import { loadEpisodeArtifact } from "../db/artifacts";
import { backfillExistingEpisodes, ingestEpisodesOnly } from "./ingest";
import sampleHtml from "../../test/fixtures/sample-mobilebasic.html?raw";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('doc', 'Doc')").run();
});

describe("backfillExistingEpisodes", () => {
  it("updates existing episodes/chunks with rich fidelity artifacts and marks them stale", async () => {
    const parsed = parseHtmlDocument(sampleHtml);
    await ingestEpisodesOnly(env.DB, 1, parsed);

    const backfill = await backfillExistingEpisodes(env.DB, 1, parsed);

    expect(backfill.episodesUpdated).toBe(3);
    expect(backfill.chunksUpdated).toBeGreaterThan(0);

    expect(await loadEpisodeArtifact(env.DB, 1, "content_markdown")).toBeTruthy();
    expect(await loadEpisodeArtifact(env.DB, 1, "rich_content_json")).toBeTruthy();

    const chunk = await env.DB.prepare(
      "SELECT content_markdown, rich_content_json, links_json, images_json, enriched, enrichment_version FROM chunks ORDER BY id LIMIT 1"
    ).first<{ content_markdown: string | null; rich_content_json: string | null; links_json: string | null; images_json: string | null; enriched: number; enrichment_version: number }>();
    expect(chunk?.content_markdown).toBeTruthy();
    expect(chunk?.rich_content_json).toBeTruthy();
    expect(chunk?.enriched).toBe(0);
    expect(chunk?.enrichment_version).toBe(0);
  });
});
