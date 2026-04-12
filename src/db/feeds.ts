export async function getSitemapData(db: D1Database) {
  const [episodes, chunks, tags] = await Promise.all([
    db.prepare("SELECT slug, updated_at FROM episodes").all(),
    db.prepare("SELECT slug, updated_at FROM chunks").all(),
    db.prepare("SELECT slug FROM tags WHERE usage_count > 0").all(),
  ]);
  return {
    episodes: episodes.results as any[],
    chunks: chunks.results as any[],
    tags: tags.results as any[],
  };
}
