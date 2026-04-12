export async function getSitemapData(db: D1Database) {
  const [episodes, chunks, tags] = await Promise.all([
    db.prepare("SELECT slug, updated_at FROM episodes").all(),
    db.prepare("SELECT slug, updated_at FROM chunks LIMIT 5000").all(),
    db.prepare("SELECT slug FROM tags WHERE usage_count > 0").all(),
  ]);
  return {
    episodes: episodes.results as any[],
    chunks: chunks.results as any[],
    tags: tags.results as any[],
  };
}

export async function getFeedEpisodes(db: D1Database, limit = 20) {
  const result = await db.prepare(
    `SELECT e.*, GROUP_CONCAT(c.title, ', ') as chunk_titles
     FROM episodes e
     LEFT JOIN chunks c ON e.id = c.episode_id
     GROUP BY e.id
     ORDER BY e.published_date DESC
     LIMIT ?`
  ).bind(limit).all();
  return result.results as any[];
}
