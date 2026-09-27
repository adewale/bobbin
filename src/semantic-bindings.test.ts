/**
 * The semantic half of bobbin (embeddings, Vectorize upsert, hybrid search,
 * cross-references) through the AI and VECTORIZE bindings that
 * vitest.config.ts binds for every workers-pool test (test/fakes/).
 *
 * Nothing here injects a per-test mock: production code runs against the
 * same `env` the rest of the suite gets, so these paths can no longer be
 * dead under test because the bindings are missing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { applyTestMigrations } from "../test/helpers/migrations";
import { ingestParsedEpisodes } from "./jobs/ingest";
import { getCrossReferences } from "./services/cross-refs";
import worker from "./index";
import type { ParsedEpisode } from "./types";

function episode(isoDate: string, title: string, chunkTexts: string[]): ParsedEpisode {
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
    chunks: chunkTexts.map((text, i) => ({
      title: text.split(" ").slice(0, 3).join(" "),
      content: text,
      contentPlain: text,
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

// The semantic query contains every word of the first chunk plus one that
// appears nowhere, so FTS (implicit AND) cannot match and only the vector
// path can surface the chunk. (The route embeds the raw query, operators
// included, so similarity must also clear 0.72 with "year:2026" appended.)
const ECHO = "Compounding loops shape resilient ecosystems";
const ECHO_LATER = "Compounding loops shape resilient ecosystems again";
const UNRELATED = "Quarterly invoices arrive by courier";
const SEMANTIC_QUERY = "compounding loops shape resilient ecosystems zanzibar";

async function ingestFixture() {
  const result = await ingestParsedEpisodes(env as any, 1, [
    episode("2026-03-02", "First week", [ECHO, UNRELATED]),
    episode("2026-03-09", "Second week", [ECHO_LATER]),
  ]);
  const chunks = await env.DB.prepare(
    "SELECT id, slug, content_plain, vector_id FROM chunks ORDER BY id"
  ).all<{ id: number; slug: string; content_plain: string; vector_id: string | null }>();
  return { result, chunks: chunks.results };
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('semantic-doc', 'Test')").run();
});

describe("AI and VECTORIZE bindings in the test runtime", () => {
  it("binds both, so `env.AI && env.VECTORIZE` guards take the bound branch", async () => {
    expect(env.AI).toBeTruthy();
    expect(env.VECTORIZE).toBeTruthy();
    const index = await env.VECTORIZE.describe();
    expect((index as any).config).toEqual({ dimensions: 768, metric: "cosine" });
  });

  it("returns 768-dimension embeddings for bge-base, like Workers AI", async () => {
    const out = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: ["a", "b"] }) as any;
    expect(out.shape).toEqual([2, 768]);
    expect(out.data).toHaveLength(2);
    expect(out.data[0]).toHaveLength(768);
  });
});

describe("ingest -> embed -> upsert", () => {
  it("embeds every inserted chunk into the index with filterable metadata", async () => {
    const { result, chunks } = await ingestFixture();
    expect(result.chunksAdded).toBe(3);
    const vectorIds = chunks.map((c) => c.vector_id).filter((id): id is string => !!id);
    expect(vectorIds).toHaveLength(3);

    const stored = await env.VECTORIZE.getByIds(vectorIds);
    expect(stored.map((v) => v.id).sort()).toEqual([...vectorIds].sort());
    for (const v of stored) {
      expect(v.values).toHaveLength(768);
      expect(v.metadata).toMatchObject({ year: 2026 });
      expect(typeof v.metadata?.chunkId).toBe("number");
    }

    const cached = await env.DB.prepare("SELECT COUNT(*) AS c FROM chunk_vector_cache").first<{ c: number }>();
    expect(cached!.c).toBe(3);
  });
});

describe("hybrid search vector path", () => {
  it("surfaces a chunk that only the vector path can find", async () => {
    await ingestFixture();
    const res = await SELF.fetch(`http://localhost/search?q=${encodeURIComponent(SEMANTIC_QUERY)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Compounding loops shape");
    expect(html).not.toContain("Quarterly invoices");
  });

  it("finds nothing for the same query when the bindings are absent", async () => {
    // Control: proves the hit above came from the vector path, not FTS.
    await ingestFixture();
    const res = await worker.fetch(
      new Request(`http://localhost/search?q=${encodeURIComponent(SEMANTIC_QUERY)}&control=1`),
      { ...env, AI: null, VECTORIZE: null } as any,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("Compounding loops shape");
  });

  it("pushes the year filter into Vectorize so other years cannot crowd out topK", async () => {
    await ingestFixture();
    // 16 chunks from 2025 that are closer to the query than the 2026 chunk.
    // The route asks Vectorize for 15 matches; without the metadata filter
    // they would all be 2025 hits, dropped later by the SQL year filter.
    await ingestParsedEpisodes(env as any, 1, [
      episode("2025-06-02", "Crowd week", Array.from({ length: 16 }, (_, i) =>
        `compounding loops shape resilient ecosystems zanzibar year 2026 crowd${i}`)),
    ]);
    const res = await SELF.fetch(`http://localhost/search?q=${encodeURIComponent(SEMANTIC_QUERY + " year:2026")}&crowd=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Compounding loops shape");
    expect(html).not.toContain("crowd0");
  });

  it("excludes vector hits outside the year filter", async () => {
    await ingestFixture();
    const inYear = await SELF.fetch(`http://localhost/search?q=${encodeURIComponent(SEMANTIC_QUERY + " year:2026")}`);
    expect(await inYear.text()).toContain("Compounding loops shape");
    const otherYear = await SELF.fetch(`http://localhost/search?q=${encodeURIComponent(SEMANTIC_QUERY + " year:2025")}`);
    expect(otherYear.status).toBe(200);
    expect(await otherYear.text()).not.toContain("Compounding loops shape");
  });
});

describe("cross-references", () => {
  it("links a chunk to its near-duplicate in another episode and not to unrelated chunks", async () => {
    const { chunks } = await ingestFixture();
    const echo = chunks.find((c) => c.content_plain === ECHO)!;
    const later = chunks.find((c) => c.content_plain === ECHO_LATER)!;

    const refs = await getCrossReferences(env.VECTORIZE, env.DB, echo.vector_id!, echo.id);
    expect(refs.map((r) => r.chunkId)).toEqual([later.id]);
    expect(refs[0].slug).toBe(later.slug);
    expect(refs[0].score).toBeGreaterThanOrEqual(0.75);
  });
});
