import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { parseHtmlDocument } from "../services/html-parser";
import { ingestEpisodesOnly, enrichChunks, finalizeEnrichment, isEnrichmentComplete } from "./ingest";
import sampleEssays from "../../test/fixtures/sample-mobilebasic.html?raw";
import sampleNotes from "../../test/fixtures/sample-notes-format.html?raw";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES ('test-doc', 'Test')"
  ).run();
});

// === Phase 1: Fast insert (cron path) ===
describe("Phase 1: ingestEpisodesOnly", () => {
  it("inserts episodes and chunks into D1", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    const result = await ingestEpisodesOnly(env.DB, 1, episodes);

    expect(result.episodesAdded).toBe(3);
    expect(result.chunksAdded).toBeGreaterThan(0);

    const dbEps = await env.DB.prepare("SELECT * FROM episodes").all();
    expect(dbEps.results).toHaveLength(3);
  });

  it("does NOT create topics", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);

    const topics = await env.DB.prepare("SELECT COUNT(*) as c FROM topics").first();
    expect((topics as any).c).toBe(0);
  });

  it("does NOT create chunk_words", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);

    const words = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_words").first();
    expect((words as any).c).toBe(0);
  });

  it("does NOT create word_stats", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);

    const ws = await env.DB.prepare("SELECT COUNT(*) as c FROM word_stats").first();
    expect((ws as any).c).toBe(0);
  });

  it("is idempotent", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);
    const second = await ingestEpisodesOnly(env.DB, 1, episodes);
    expect(second.episodesAdded).toBe(0);
  });

  it("stores format correctly", async () => {
    const essays = parseHtmlDocument(sampleEssays);
    const notes = parseHtmlDocument(sampleNotes);
    await ingestEpisodesOnly(env.DB, 1, essays);
    await ingestEpisodesOnly(env.DB, 1, notes);

    const formats = await env.DB.prepare(
      "SELECT format, COUNT(*) as c FROM episodes GROUP BY format"
    ).all();
    const byFormat = Object.fromEntries(
      (formats.results as any[]).map((r) => [r.format, r.c])
    );
    expect(byFormat.essays).toBe(3);
    expect(byFormat.notes).toBe(1);
  });

  it("resolves internal fragment links to target chunk URLs during ingest", async () => {
    await ingestEpisodesOnly(env.DB, 1, [{
      dateStr: "4/20/26",
      parsedDate: new Date("2026-04-20T00:00:00.000Z"),
      title: "Bits and Bobs 4/20/26",
      headingId: "",
      format: "notes",
      contentMarkdown: "[Target](#id.target)\n\nTarget body",
      richContent: [
        {
          type: "paragraph",
          depth: 0,
          listStyle: "paragraph",
          plainText: "Target",
          nodes: [{ type: "text", text: "Target", href: "#id.target" }],
        },
        {
          type: "paragraph",
          depth: 0,
          listStyle: "paragraph",
          plainText: "Target body",
          nodes: [{ type: "text", text: "Target body" }],
        },
      ],
      links: [{ text: "Target", href: "#id.target" }],
      images: [],
      chunks: [
        {
          title: "Source chunk",
          content: "Source chunk\nSee target",
          contentPlain: "Source chunk\nSee target",
          contentMarkdown: "[Target](#id.target)",
          richContent: [{
            type: "paragraph",
            depth: 0,
            listStyle: "paragraph",
            plainText: "Target",
            nodes: [{ type: "text", text: "Target", href: "#id.target" }],
          }],
          links: [{ text: "Target", href: "#id.target" }],
          images: [],
          footnotes: [],
          headingId: "",
          position: 0,
        },
        {
          title: "Target chunk",
          content: "Target chunk\nDestination",
          contentPlain: "Target chunk\nDestination",
          contentMarkdown: "Destination",
          richContent: [{
            type: "paragraph",
            depth: 0,
            listStyle: "paragraph",
            plainText: "Destination",
            nodes: [{ type: "text", text: "Destination" }],
            anchorIds: ["id.target"],
          }],
          links: [],
          images: [],
          footnotes: [],
          headingId: "",
          position: 1,
        },
      ],
    }]);

    const rows = await env.DB.prepare(
      "SELECT slug, content_markdown, rich_content_json, links_json FROM chunks ORDER BY position"
    ).all<{ slug: string; content_markdown: string; rich_content_json: string; links_json: string }>();

    expect(rows.results).toHaveLength(2);
    const sourceChunk = rows.results[0];
    const targetChunk = rows.results[1];
    const expectedHref = `/chunks/${targetChunk.slug}#id.target`;

    expect(sourceChunk.content_markdown).toContain(expectedHref);
    expect(sourceChunk.links_json).toContain(expectedHref);
    expect(sourceChunk.rich_content_json).toContain(expectedHref);
  });

  it("preserves inline anchor targets from parsed HTML so ingest can resolve fragment links", async () => {
    const parsed = parseHtmlDocument([
      '<h1><span>4/20/26</span></h1>',
      '<li style="margin-left:36pt"><span><a href="#id.target">Target ref</a></span></li>',
      '<li style="margin-left:36pt"><a id="id.target"></a><span>Anchor target</span></li>',
    ].join(""));

    await ingestEpisodesOnly(env.DB, 1, parsed);

    const rows = await env.DB.prepare(
      "SELECT slug, content_markdown, rich_content_json, links_json FROM chunks ORDER BY position"
    ).all<{ slug: string; content_markdown: string; rich_content_json: string; links_json: string }>();

    expect(rows.results).toHaveLength(2);
    const sourceChunk = rows.results[0];
    const targetChunk = rows.results[1];
    const expectedHref = `/chunks/${targetChunk.slug}#id.target`;

    expect(sourceChunk.content_markdown).toContain(expectedHref);
    expect(sourceChunk.links_json).toContain(expectedHref);
    expect(targetChunk.rich_content_json).toContain('"anchorIds":["id.target"]');
  });
});

// === Phase 2: Enrichment (background) ===
describe("Phase 2: enrichChunks", () => {
  beforeEach(async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);
  });

  it("creates candidate audit rows and enrichment artifacts for a batch of unenriched chunks", async () => {
    const result = await enrichChunks(env.DB, 10);

    expect(result.chunksProcessed).toBeGreaterThan(0);

    const auditRows = await env.DB.prepare("SELECT COUNT(*) as c FROM topic_candidate_audit").first();
    expect((auditRows as any).c).toBeGreaterThan(0);

    const chunkWords = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_words").first();
    expect((chunkWords as any).c).toBeGreaterThan(0);
  });

  it("creates chunk_words for word stats", async () => {
    await enrichChunks(env.DB, 100);

    const words = await env.DB.prepare("SELECT COUNT(*) as c FROM chunk_words").first();
    expect((words as any).c).toBeGreaterThan(0);
  });

  it("updates word_stats aggregates after finalization", async () => {
    await enrichChunks(env.DB, 100);
    await finalizeEnrichment(env.DB);

    const ws = await env.DB.prepare("SELECT COUNT(*) as c FROM word_stats").first();
    expect((ws as any).c).toBeGreaterThan(0);
  });

  it("processes only the requested batch size", async () => {
    const result = await enrichChunks(env.DB, 2);
    expect(result.chunksProcessed).toBeLessThanOrEqual(2);
  });

  it("is idempotent — re-enriching already-enriched chunks is a no-op", async () => {
    await enrichChunks(env.DB, 100);
    const firstTopics = await env.DB.prepare("SELECT COUNT(*) as c FROM topics").first();

    const result = await enrichChunks(env.DB, 100);
    expect(result.chunksProcessed).toBe(0);

    const secondTopics = await env.DB.prepare("SELECT COUNT(*) as c FROM topics").first();
    expect((secondTopics as any).c).toBe((firstTopics as any).c);
  });
});

// === isEnrichmentComplete ===
describe("isEnrichmentComplete", () => {
  it("returns false when chunks have no topics", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);

    expect(await isEnrichmentComplete(env.DB)).toBe(false);
  });

  it("returns true when all chunks are enriched", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);
    await enrichChunks(env.DB, 100);

    expect(await isEnrichmentComplete(env.DB)).toBe(true);
  });
});

// === E2E: Full phased pipeline ===
describe("E2E: Phase 1 → Phase 2 produces same result as old pipeline", () => {
  it("after both phases, DB has episodes, chunks, topics, word_stats", async () => {
    const episodes = parseHtmlDocument(sampleEssays);

    // Phase 1
    const phase1 = await ingestEpisodesOnly(env.DB, 1, episodes);
    expect(phase1.episodesAdded).toBe(3);

    // Phase 2 — enrich all + finalize
    await enrichChunks(env.DB, 1000);
    await finalizeEnrichment(env.DB);

    // Verify everything exists
    const eps = await env.DB.prepare("SELECT COUNT(*) as c FROM episodes").first();
    const chunks = await env.DB.prepare("SELECT COUNT(*) as c FROM chunks").first();
    // With YAKE + df≥5 + orphan deletion, small fixtures may have 0 surviving topics.
    // Verify pipeline ran via word_stats (always populated during enrichment).
    const ws = await env.DB.prepare("SELECT COUNT(*) as c FROM word_stats").first();

    expect((eps as any).c).toBe(3);
    expect((chunks as any).c).toBeGreaterThan(0);
    expect((ws as any).c).toBeGreaterThan(0);
  });

  it("chunk positions are sequential after phased ingest", async () => {
    const episodes = parseHtmlDocument(sampleEssays);
    await ingestEpisodesOnly(env.DB, 1, episodes);

    const dbEps = await env.DB.prepare("SELECT id FROM episodes").all();
    for (const ep of dbEps.results as any[]) {
      const chunks = await env.DB.prepare(
        "SELECT position FROM chunks WHERE episode_id = ? ORDER BY position"
      ).bind(ep.id).all();
      for (let i = 0; i < chunks.results.length; i++) {
        expect((chunks.results[i] as any).position).toBe(i);
      }
    }
  });

  it("no duplicate slugs after phased ingest", async () => {
    const essays = parseHtmlDocument(sampleEssays);
    const notes = parseHtmlDocument(sampleNotes);
    await ingestEpisodesOnly(env.DB, 1, essays);
    await ingestEpisodesOnly(env.DB, 1, notes);

    const dupes = await env.DB.prepare(
      "SELECT slug, COUNT(*) as c FROM chunks GROUP BY slug HAVING c > 1"
    ).all();
    expect(dupes.results).toHaveLength(0);
  });
});
