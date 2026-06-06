import type { ParsedQuery } from "../lib/query-parser";

export interface ChunkVectorMetadataRow {
  id: number;
  vector_id: string;
  published_date: string;
  year: number;
  topic_slugs?: string | null;
}

export function parseTopicSlugs(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function chunkVectorMetadata(row: ChunkVectorMetadataRow): Record<string, VectorizeVectorMetadata> {
  return {
    chunkId: row.id,
    publishedDate: row.published_date,
    year: row.year,
    topics: parseTopicSlugs(row.topic_slugs),
  };
}

export function vectorizeMetadataFilter(parsed: Pick<ParsedQuery, "before" | "after" | "year" | "topics">): VectorizeVectorMetadataFilter | undefined {
  const filter: VectorizeVectorMetadataFilter = {};
  if (parsed.year) filter.year = parsed.year;
  if (parsed.after) filter.publishedDate = { ...(typeof filter.publishedDate === "object" && filter.publishedDate ? filter.publishedDate : {}), $gte: parsed.after };
  if (parsed.before) filter.publishedDate = { ...(typeof filter.publishedDate === "object" && filter.publishedDate ? filter.publishedDate : {}), $lte: parsed.before };
  if (parsed.topics && parsed.topics.length > 0) filter.topics = { $in: parsed.topics };
  return Object.keys(filter).length > 0 ? filter : undefined;
}
