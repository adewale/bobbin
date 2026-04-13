export async function getMostConnected(db: D1Database, limit = 8) {
  // Try precomputed reach first; fall back to computed if no reach data
  const hasReach = await db.prepare(
    "SELECT COUNT(*) as c FROM chunks WHERE reach > 0"
  ).first<{ c: number }>();

  if (hasReach && hasReach.c > 0) {
    const result = await db.prepare(
      `SELECT c.id, c.slug, c.title, c.reach,
              e.slug as episode_slug, e.published_date
       FROM chunks c
       JOIN episodes e ON c.episode_id = e.id
       WHERE c.reach > 0
       ORDER BY c.reach DESC
       LIMIT ?`
    ).bind(limit).all();
    return result.results;
  }

  // Fallback: compute on the fly (slower but works without enrichment)
  const result = await db.prepare(
    `SELECT c.id, c.slug, c.title,
            e.slug as episode_slug, e.published_date,
            SUM(t.usage_count) as reach
     FROM chunks c
     JOIN chunk_topics ct ON c.id = ct.chunk_id
     JOIN topics t ON ct.topic_id = t.id
     JOIN episodes e ON c.episode_id = e.id
     GROUP BY c.id
     ORDER BY reach DESC
     LIMIT ?`
  ).bind(limit).all();
  return result.results;
}
