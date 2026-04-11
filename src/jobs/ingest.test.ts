import { describe, it, expect, beforeEach } from "vitest";
import { ingestParsedEpisodes } from "./ingest";
import { parseDocument } from "../services/doc-parser";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import sampleDoc from "../../test/fixtures/sample-doc.json";

const parsedEpisodes = parseDocument(sampleDoc as any);

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
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    const result = await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    expect(result.episodesAdded).toBe(2);
    expect(result.chunksAdded).toBe(3);

    const episodes = await env.DB.prepare(
      "SELECT * FROM episodes ORDER BY published_date DESC"
    ).all();
    expect(episodes.results).toHaveLength(2);
    expect((episodes.results[0] as any).slug).toContain("2024-04-08");
    expect((episodes.results[1] as any).slug).toContain("2024-03-25");
  });

  it("inserts chunks with correct content", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    const chunks = await env.DB.prepare("SELECT * FROM chunks ORDER BY id").all();
    expect(chunks.results).toHaveLength(3);
    expect((chunks.results[0] as any).title).toBe("Nanotech cages for circus bears");
    expect((chunks.results[0] as any).content).toContain("contain powerful AI systems");
  });

  it("generates tags for chunks", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    const tags = await env.DB.prepare("SELECT * FROM tags").all();
    expect(tags.results.length).toBeGreaterThan(0);
  });

  it("is idempotent — re-ingesting same episodes adds no duplicates", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };

    const first = await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);
    expect(first.episodesAdded).toBe(2);

    const second = await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);
    expect(second.episodesAdded).toBe(0);
    expect(second.chunksAdded).toBe(0);
  });

  it("updates concordance after ingestion", async () => {
    const testEnv = { ...env, AI: null as any, VECTORIZE: null as any };
    await ingestParsedEpisodes(testEnv, 1, parsedEpisodes);

    const concordance = await env.DB.prepare(
      "SELECT * FROM concordance ORDER BY total_count DESC LIMIT 5"
    ).all();
    expect(concordance.results.length).toBeGreaterThan(0);
  });
});
