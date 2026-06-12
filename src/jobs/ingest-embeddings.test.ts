/**
 * Embedding behavior of the manual-ingest path (ingestParsedEpisodes).
 * Workers AI and Vectorize have per-request input limits; the ingest path
 * must batch like /api/embed does (100 per call) instead of sending every
 * inserted chunk in a single request.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { ingestParsedEpisodes } from "./ingest";
import type { ParsedEpisode } from "../types";

function makeEpisode(isoDate: string, title: string, chunkCount: number): ParsedEpisode {
  return {
    dateStr: isoDate,
    parsedDate: new Date(`${isoDate}T00:00:00.000Z`),
    title,
    headingId: "",
    format: "notes",
    contentMarkdown: "",
    richContent: [],
    links: [],
    images: [],
    chunks: Array.from({ length: chunkCount }, (_, i) => ({
      title: `${title} chunk ${i + 1}`,
      content: `${title} chunk ${i + 1}\nEcosystem platform dynamics body ${i + 1}.`,
      contentPlain: `${title} chunk ${i + 1}\nEcosystem platform dynamics body ${i + 1}.`,
      contentMarkdown: "",
      richContent: [],
      links: [],
      images: [],
      footnotes: [],
      headingId: "",
      position: i,
    })),
  };
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test-doc', 'Test')").run();
});

describe("ingestParsedEpisodes embeddings", () => {
  it("embeds and upserts inserted chunks in batches within provider limits", async () => {
    const embedCallSizes: number[] = [];
    const upsertSizes: number[] = [];
    const fakeAi = {
      run: async (model: string, input: { text?: string[] }) => {
        if (String(model).includes("bge")) {
          embedCallSizes.push(input.text?.length ?? 0);
          return { data: (input.text ?? []).map(() => [0.1, 0.2, 0.3]) };
        }
        // LLM candidate generation: return an empty, well-formed response
        return { response: "[]" };
      },
    };
    const fakeVectorize = {
      upsert: async (vectors: unknown[]) => {
        upsertSizes.push(vectors.length);
        return { count: vectors.length };
      },
    };
    const testEnv = {
      ...env,
      AI: fakeAi,
      VECTORIZE: fakeVectorize,
    } as any;

    // 120 chunks across 3 episodes — more than one embedding batch
    const result = await ingestParsedEpisodes(testEnv, 1, [
      makeEpisode("2026-04-06", "Week one", 40),
      makeEpisode("2026-04-13", "Week two", 40),
      makeEpisode("2026-04-20", "Week three", 40),
    ]);

    expect(result.chunksAdded).toBe(120);

    // Every chunk is embedded exactly once, and no single AI call or
    // Vectorize upsert exceeds the 100-input batch used by /api/embed.
    expect(embedCallSizes.reduce((a, b) => a + b, 0)).toBe(120);
    expect(Math.max(...embedCallSizes)).toBeLessThanOrEqual(100);
    expect(embedCallSizes.length).toBeGreaterThan(1);
    expect(upsertSizes.reduce((a, b) => a + b, 0)).toBe(120);
    expect(Math.max(...upsertSizes)).toBeLessThanOrEqual(100);

    const cached = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM chunk_vector_cache"
    ).first<{ c: number }>();
    expect(cached!.c).toBe(120);
  }, 30000);
});
