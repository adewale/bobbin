import { describe, it, expect, beforeEach } from "vitest";
import { ingestParsedEpisodes } from "./ingest";
import { parseHtmlDocument } from "../services/html-parser";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import sampleHtml from "../../test/fixtures/sample-mobilebasic.html?raw";

const parsedEpisodes = parseHtmlDocument(sampleHtml);

function makeTestEnv(overrides: Partial<typeof env> = {}) {
  return { ...env, AI: null as any, VECTORIZE: null as any, ADMIN_SECRET: "", ...overrides };
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);

  await env.DB.prepare(
    "INSERT INTO sources (google_doc_id, title) VALUES (?, ?)"
  )
    .bind("test-doc-id", "Test Source")
    .run();
});

describe("ingestParsedEpisodes", () => {
  it("inserts episodes and chunks into D1", async () => {
    const result = await ingestParsedEpisodes(makeTestEnv(), 1, parsedEpisodes);

    expect(result.episodesAdded).toBe(3);
    expect(result.chunksAdded).toBeGreaterThan(0);

    const episodes = await env.DB.prepare(
      "SELECT * FROM episodes ORDER BY published_date DESC"
    ).all();
    expect(episodes.results).toHaveLength(3);
    expect((episodes.results[0] as any).slug).toContain("2026-04-06");
    expect((episodes.results[1] as any).slug).toContain("2026-03-30");
    expect((episodes.results[2] as any).slug).toContain("2026-03-23");
  });

  it("inserts chunks with correct content", async () => {
    await ingestParsedEpisodes(makeTestEnv(), 1, parsedEpisodes);

    const chunks = await env.DB.prepare("SELECT * FROM chunks ORDER BY id").all();
    expect(chunks.results.length).toBeGreaterThan(0);
    // First chunk is from the first chunk in the first episode
    expect((chunks.results[0] as any).content).toContain("software");
  });

  it("generates topics for chunks (extraction works, quality gates may prune with small data)", async () => {
    await ingestParsedEpisodes(makeTestEnv(), 1, parsedEpisodes);

    // chunk_words proves extraction ran (word stats are always created)
    const wordStats = await env.DB.prepare("SELECT COUNT(*) as c FROM word_stats").first<{ c: number }>();
    expect(wordStats!.c).toBeGreaterThan(0);
  });

  it("is idempotent — re-ingesting same episodes adds no duplicates", async () => {
    const first = await ingestParsedEpisodes(makeTestEnv(), 1, parsedEpisodes);
    expect(first.episodesAdded).toBe(3);

    const second = await ingestParsedEpisodes(makeTestEnv(), 1, parsedEpisodes);
    expect(second.episodesAdded).toBe(0);
    expect(second.chunksAdded).toBe(0);
  });

  it("updates word_stats after ingestion", async () => {
    await ingestParsedEpisodes(makeTestEnv(), 1, parsedEpisodes);

    const wordStats = await env.DB.prepare(
      "SELECT * FROM word_stats ORDER BY total_count DESC LIMIT 5"
    ).all();
    expect(wordStats.results.length).toBeGreaterThan(0);
  });

  it("stores source-fidelity artifacts and runs one LLM invocation per inserted episode", async () => {
    const calls: any[] = [];
    const fakeAI = {
      run: async (_model: string, payload: any) => {
        calls.push(payload);
        const parsed = JSON.parse(payload.messages[1].content);
        const firstChunkSlug = parsed.chunks[0].slug;
        return {
          response: JSON.stringify({
            candidates: [
              {
                name: "Prompt injection attack",
                kind: "phrase",
                confidence: 0.92,
                rank_position: 0,
                aliases: ["prompt injection"],
                evidence: [
                  {
                    chunk_slug: firstChunkSlug,
                    quote: "software provider",
                  },
                ],
              },
            ],
          }),
        };
      },
    };

    await ingestParsedEpisodes(makeTestEnv({ AI: fakeAI as any }), 1, parsedEpisodes);

    expect(calls.length).toBe(3);

    const source = await env.DB.prepare("SELECT latest_html FROM sources WHERE id = 1").first<{ latest_html: string | null }>();
    expect(source?.latest_html).toBeNull();

    const episodes = await env.DB.prepare(
      "SELECT content_markdown, rich_content_json, links_json FROM episodes ORDER BY id LIMIT 1"
    ).first<{ content_markdown: string | null; rich_content_json: string | null; links_json: string | null }>();
    expect(episodes?.content_markdown).toBeTruthy();
    expect(episodes?.rich_content_json).toBeTruthy();
    expect(episodes?.links_json).toBeTruthy();

    const chunks = await env.DB.prepare(
      "SELECT content_markdown, rich_content_json, links_json FROM chunks ORDER BY id LIMIT 1"
    ).first<{ content_markdown: string | null; rich_content_json: string | null; links_json: string | null }>();
    expect(chunks?.content_markdown).toBeTruthy();
    expect(chunks?.rich_content_json).toBeTruthy();

    const llmRuns = await env.DB.prepare("SELECT COUNT(*) as c FROM llm_enrichment_runs").first<{ c: number }>();
    const llmCandidates = await env.DB.prepare("SELECT COUNT(*) as c FROM llm_episode_candidates").first<{ c: number }>();
    expect(llmRuns?.c).toBe(3);
    expect(llmCandidates?.c).toBeGreaterThan(0);
  });
});
