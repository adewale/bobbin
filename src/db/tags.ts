import type { TagRow } from "../types";

export async function getTopTags(db: D1Database, limit: number): Promise<TagRow[]> {
  const result = await db.prepare(
    "SELECT * FROM tags WHERE usage_count > 0 ORDER BY usage_count DESC LIMIT ?"
  ).bind(limit).all<TagRow>();
  return result.results;
}

export async function getTagBySlug(db: D1Database, slug: string): Promise<TagRow | null> {
  return await db.prepare("SELECT * FROM tags WHERE slug = ?")
    .bind(slug).first<TagRow>();
}
