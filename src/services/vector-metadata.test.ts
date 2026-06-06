import { describe, expect, it } from "vitest";
import { chunkVectorMetadata, parseTopicSlugs, vectorizeMetadataFilter } from "./vector-metadata";

describe("vector metadata", () => {
  it("builds indexed metadata for Vectorize filtering", () => {
    expect(chunkVectorMetadata({
      id: 12,
      vector_id: "vec-12",
      published_date: "2025-03-03",
      year: 2025,
      topic_slugs: '["ai","agents"]',
    })).toEqual({
      chunkId: 12,
      publishedDate: "2025-03-03",
      year: 2025,
      topics: ["ai", "agents"],
    });
  });

  it("tolerates missing or malformed topic JSON", () => {
    expect(parseTopicSlugs(null)).toEqual([]);
    expect(parseTopicSlugs("not json")).toEqual([]);
  });

  it("converts parsed query operators into a Vectorize metadata filter", () => {
    expect(vectorizeMetadataFilter({
      year: 2025,
      after: "2025-01-01",
      before: "2025-12-31",
      topics: ["ai"],
    })).toEqual({
      year: 2025,
      publishedDate: { $gte: "2025-01-01", $lte: "2025-12-31" },
      topics: { $in: ["ai"] },
    });
  });
});
