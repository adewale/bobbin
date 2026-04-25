import { beforeEach, describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { findCrossReferences, getCrossReferences } from "./cross-refs";

describe("findCrossReferences", () => {
  it("identifies chunks with high similarity scores", () => {
    // Simulate Vectorize results
    const matches = [
      { id: "chunk-2024-01-15-0", score: 0.92, metadata: { chunkId: 1, title: "Ecosystem growth" } },
      { id: "chunk-2024-03-18-0", score: 0.88, metadata: { chunkId: 3, title: "Ecosystem decline" } },
      { id: "chunk-2024-02-12-1", score: 0.65, metadata: { chunkId: 5, title: "LLM thoughts" } },
      { id: "chunk-2024-01-15-1", score: 0.45, metadata: { chunkId: 2, title: "Platform markets" } },
    ];

    const refs = findCrossReferences(matches, "chunk-2024-04-08-0", 0.7);
    expect(refs).toHaveLength(2);
    expect(refs[0].title).toBe("Ecosystem growth");
    expect(refs[1].title).toBe("Ecosystem decline");
  });

  it("excludes the source chunk itself", () => {
    const matches = [
      { id: "chunk-self", score: 1.0, metadata: { chunkId: 99, title: "Self" } },
      { id: "chunk-other", score: 0.85, metadata: { chunkId: 1, title: "Other" } },
    ];
    const refs = findCrossReferences(matches, "chunk-self", 0.7);
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBe("Other");
  });

  it("returns empty when nothing exceeds threshold", () => {
    const matches = [
      { id: "chunk-1", score: 0.5, metadata: { chunkId: 1, title: "Low" } },
    ];
    const refs = findCrossReferences(matches, "chunk-self", 0.7);
    expect(refs).toHaveLength(0);
  });
});

describe("getCrossReferences", () => {
  beforeEach(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('t', 'T')"),
      env.DB.prepare(
        "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count) VALUES (1, 'ep-1', 'Episode 1', '2024-01-01', 2024, 1, 1, 0)"
      ),
    ]);
  });

  it("hydrates cross references when the vector result set exceeds the D1 bind cap", async () => {
    const chunkInserts = Array.from({ length: 140 }, (_, index) => {
      const n = index + 1;
      return env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, vector_id, position) VALUES (1, ?, ?, ?, ?, ?, ?)"
      ).bind(
        `xref-${n}`,
        `Cross reference ${n}`,
        `Cross reference ${n}`,
        `Cross reference ${n}`,
        `vec-${n}`,
        n,
      );
    });
    await env.DB.batch(chunkInserts);

    const vectorize = {
      getByIds: async () => [{ values: [0.1, 0.2, 0.3] }],
      query: async () => ({
        matches: Array.from({ length: 140 }, (_, index) => ({
          id: `vec-${index + 1}`,
          score: 0.91,
          metadata: { chunkId: index + 1, title: `Cross reference ${index + 1}` },
        })),
      }),
    } as unknown as VectorizeIndex;

    const refs = await getCrossReferences(vectorize, env.DB, "source-vec", 999, 140, 0.7);

    expect(refs).toHaveLength(140);
    expect(refs[0]?.slug).toBe("xref-1");
    expect(refs[139]?.slug).toBe("xref-140");
    expect(refs.every((ref) => ref.episodeSlug === "ep-1")).toBe(true);
    expect(refs.every((ref) => ref.publishedDate === "2024-01-01")).toBe(true);
  });
});
