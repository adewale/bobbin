const ARTIFACT_CHUNK_SIZE = 200000;

function splitContent(content: string): string[] {
  if (!content) return [];
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += ARTIFACT_CHUNK_SIZE) {
    chunks.push(content.slice(i, i + ARTIFACT_CHUNK_SIZE));
  }
  return chunks;
}

export async function persistSourceHtmlChunks(
  db: D1Database,
  sourceId: number,
  html: string,
  fetchedAt: string,
): Promise<void> {
  await db.prepare("DELETE FROM source_html_chunks WHERE source_id = ?").bind(sourceId).run();
  const chunks = splitContent(html);
  if (chunks.length === 0) return;
  await db.batch(chunks.map((chunk, index) =>
    db.prepare(
      "INSERT INTO source_html_chunks (source_id, chunk_index, fetched_at, html_chunk) VALUES (?, ?, ?, ?)"
    ).bind(sourceId, index, fetchedAt, chunk)
  ));
}

export async function persistEpisodeArtifactChunks(
  db: D1Database,
  episodeId: number,
  artifacts: Record<string, string | null | undefined>,
): Promise<void> {
  await db.prepare("DELETE FROM episode_artifact_chunks WHERE episode_id = ?").bind(episodeId).run();
  const statements: D1PreparedStatement[] = [];
  for (const [artifactKey, content] of Object.entries(artifacts)) {
    if (!content) continue;
    const chunks = splitContent(content);
    for (const [index, chunk] of chunks.entries()) {
      statements.push(
        db.prepare(
          "INSERT INTO episode_artifact_chunks (episode_id, artifact_key, chunk_index, content_chunk) VALUES (?, ?, ?, ?)"
        ).bind(episodeId, artifactKey, index, chunk)
      );
    }
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function loadEpisodeArtifact(db: D1Database, episodeId: number, artifactKey: string): Promise<string | null> {
  const rows = await db.prepare(
    "SELECT content_chunk FROM episode_artifact_chunks WHERE episode_id = ? AND artifact_key = ? ORDER BY chunk_index"
  ).bind(episodeId, artifactKey).all<{ content_chunk: string }>();
  if (rows.results.length === 0) return null;
  return rows.results.map((row) => row.content_chunk).join("");
}
