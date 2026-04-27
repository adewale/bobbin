import { collectInBatches, sqlPlaceholders } from "../lib/db";
import { blendTopicSimilarity, cosineSimilarity, meanPoolVectors } from "../lib/topic-metrics";

const MAX_RELATED_TOPICS = 12;

function parseVectorJson(value: string): number[] | null {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const vector = parsed.map((item) => Number(item));
    return vector.every((item) => Number.isFinite(item)) ? vector : null;
  } catch {
    return null;
  }
}

export async function persistChunkEmbeddingCache(
  db: D1Database,
  chunks: Array<{ id: number }>,
  embeddings: number[][],
): Promise<number> {
  if (chunks.length === 0 || embeddings.length === 0) return 0;
  const statements = chunks
    .map((chunk, index) => {
      const vector = embeddings[index];
      if (!vector) return null;
      return db.prepare(
        `INSERT INTO chunk_vector_cache (chunk_id, vector_json, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(chunk_id) DO UPDATE SET vector_json = excluded.vector_json, updated_at = datetime('now')`
      ).bind(chunk.id, JSON.stringify(vector));
    })
    .filter((statement): statement is D1PreparedStatement => statement !== null);

  if (statements.length === 0) return 0;
  await db.batch(statements);
  return statements.length;
}

export async function recomputeTopicEmbeddingCache(db: D1Database, topicIds: number[]): Promise<number> {
  if (topicIds.length === 0) return 0;

  const rows = await collectInBatches(topicIds, async (batch) => {
    const placeholders = sqlPlaceholders(batch.length);
    const result = await db.prepare(
      `SELECT ct.topic_id, cvc.vector_json
       FROM chunk_topics ct
       JOIN chunk_vector_cache cvc ON cvc.chunk_id = ct.chunk_id
       WHERE ct.topic_id IN (${placeholders})`
    ).bind(...batch).all<{ topic_id: number; vector_json: string }>();
    return result.results;
  });

  const vectorsByTopic = new Map<number, number[][]>();
  for (const row of rows) {
    const vector = parseVectorJson(row.vector_json);
    if (!vector) continue;
    const current = vectorsByTopic.get(row.topic_id) ?? [];
    current.push(vector);
    vectorsByTopic.set(row.topic_id, current);
  }

  const upserts: D1PreparedStatement[] = [];
  const deletions: D1PreparedStatement[] = [];
  for (const topicId of topicIds) {
    const pooled = meanPoolVectors(vectorsByTopic.get(topicId) ?? []);
    if (!pooled) {
      deletions.push(db.prepare("DELETE FROM topic_embedding_cache WHERE topic_id = ?").bind(topicId));
      continue;
    }
    upserts.push(
      db.prepare(
        `INSERT INTO topic_embedding_cache (topic_id, vector_json, chunk_count, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(topic_id) DO UPDATE SET vector_json = excluded.vector_json, chunk_count = excluded.chunk_count, updated_at = datetime('now')`
      ).bind(topicId, JSON.stringify(pooled), vectorsByTopic.get(topicId)?.length ?? 0)
    );
  }

  if (deletions.length > 0) await db.batch(deletions);
  if (upserts.length > 0) await db.batch(upserts);
  return upserts.length;
}

export async function loadDirtyTopicIds(db: D1Database): Promise<number[]> {
  const result = await db.prepare("SELECT topic_id FROM topic_dirty ORDER BY updated_at ASC, topic_id ASC").all<{ topic_id: number }>();
  return result.results.map((row) => row.topic_id);
}

export async function clearDirtyTopics(db: D1Database, topicIds?: number[]): Promise<number> {
  if (!topicIds || topicIds.length === 0) {
    const result = await db.prepare("DELETE FROM topic_dirty").run();
    return result.meta.changes || 0;
  }

  const ids = [...new Set(topicIds.filter((topicId) => Number.isInteger(topicId) && topicId > 0))];
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (let index = 0; index < ids.length; index += 90) {
    const batch = ids.slice(index, index + 90);
    const placeholders = sqlPlaceholders(batch.length);
    const result = await db.prepare(
      `DELETE FROM topic_dirty WHERE topic_id IN (${placeholders})`
    ).bind(...batch).run();
    deleted += result.meta.changes || 0;
  }
  return deleted;
}

export async function markDirtyTopicsByIds(db: D1Database, topicIds: number[], reason: string): Promise<number> {
  const ids = [...new Set(topicIds.filter((topicId) => Number.isInteger(topicId) && topicId > 0))];
  if (ids.length === 0) return 0;
  const statements = ids.map((topicId) =>
    db.prepare(
      `INSERT INTO topic_dirty (topic_id, reason, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(topic_id) DO UPDATE SET reason = excluded.reason, updated_at = datetime('now')`
    ).bind(topicId, reason)
  );
  await db.batch(statements);
  return statements.length;
}

export async function markDirtyTopicsBySlugs(db: D1Database, slugs: string[], reason: string): Promise<number> {
  const uniqueSlugs = [...new Set(slugs.filter(Boolean))];
  if (uniqueSlugs.length === 0) return 0;
  const rows = await collectInBatches(uniqueSlugs, async (batch) => {
    const placeholders = sqlPlaceholders(batch.length);
    const result = await db.prepare(
      `SELECT id FROM topics WHERE slug IN (${placeholders})`
    ).bind(...batch).all<{ id: number }>();
    return result.results;
  });
  return markDirtyTopicsByIds(db, rows.map((row) => row.id), reason);
}

export async function loadAffectedTopicIds(db: D1Database, dirtyTopicIds: number[]): Promise<number[]> {
  if (dirtyTopicIds.length === 0) return [];

  const cooccurring = await collectInBatches(dirtyTopicIds, async (batch) => {
    const placeholders = sqlPlaceholders(batch.length);
    const result = await db.prepare(
      `SELECT DISTINCT ct2.topic_id
       FROM chunk_topics ct1
       JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id
       WHERE ct1.topic_id IN (${placeholders})`
    ).bind(...batch).all<{ topic_id: number }>();
    return result.results;
  });

  return [...new Set([...dirtyTopicIds, ...cooccurring.map((row) => row.topic_id)])].sort((left, right) => left - right);
}

export async function recomputeTopicSimilarityScores(
  db: D1Database,
  sourceTopicIds: number[],
  eligibleTopicIds: number[],
): Promise<{ topicPairsWritten: number; topicsUpdated: number }> {
  if (sourceTopicIds.length === 0 || eligibleTopicIds.length === 0) {
    return { topicPairsWritten: 0, topicsUpdated: 0 };
  }

  const topicRows = await collectInBatches(eligibleTopicIds, async (batch) => {
    const placeholders = sqlPlaceholders(batch.length);
    const result = await db.prepare(
      `SELECT id, name, slug FROM topics WHERE id IN (${placeholders})`
    ).bind(...batch).all<{ id: number; name: string; slug: string }>();
    return result.results;
  });
  const topicMeta = new Map(topicRows.map((row) => [row.id, row]));

  const chunkRows = await collectInBatches(eligibleTopicIds, async (batch) => {
    const placeholders = sqlPlaceholders(batch.length);
    const result = await db.prepare(
      `SELECT topic_id, chunk_id FROM chunk_topics WHERE topic_id IN (${placeholders})`
    ).bind(...batch).all<{ topic_id: number; chunk_id: number }>();
    return result.results;
  });
  const chunkSets = new Map<number, Set<number>>();
  for (const row of chunkRows) {
    const current = chunkSets.get(row.topic_id) ?? new Set<number>();
    current.add(row.chunk_id);
    chunkSets.set(row.topic_id, current);
  }

  const embeddingRows = await collectInBatches(eligibleTopicIds, async (batch) => {
    const placeholders = sqlPlaceholders(batch.length);
    const result = await db.prepare(
      `SELECT topic_id, vector_json FROM topic_embedding_cache WHERE topic_id IN (${placeholders})`
    ).bind(...batch).all<{ topic_id: number; vector_json: string }>();
    return result.results;
  });
  const vectorsByTopic = new Map<number, number[]>();
  for (const row of embeddingRows) {
    const vector = parseVectorJson(row.vector_json);
    if (vector) vectorsByTopic.set(row.topic_id, vector);
  }

  await collectInBatches(sourceTopicIds, async (batch) => {
    const placeholders = sqlPlaceholders(batch.length);
    await db.prepare(`DELETE FROM topic_similarity_scores WHERE topic_id IN (${placeholders})`).bind(...batch).run();
    return [] as never[];
  });

  const inserts: D1PreparedStatement[] = [];
  for (const sourceTopicId of sourceTopicIds) {
    const sourceMeta = topicMeta.get(sourceTopicId);
    const sourceChunks = chunkSets.get(sourceTopicId) ?? new Set<number>();
    if (!sourceMeta || sourceChunks.size === 0) continue;

    const scored = eligibleTopicIds
      .filter((targetTopicId) => targetTopicId !== sourceTopicId)
      .map((targetTopicId) => {
        const targetMeta = topicMeta.get(targetTopicId);
        const targetChunks = chunkSets.get(targetTopicId) ?? new Set<number>();
        if (!targetMeta || targetChunks.size === 0) return null;

        let overlapCount = 0;
        const smaller = sourceChunks.size <= targetChunks.size ? sourceChunks : targetChunks;
        const larger = smaller === sourceChunks ? targetChunks : sourceChunks;
        for (const chunkId of smaller) {
          if (larger.has(chunkId)) overlapCount += 1;
        }
        const unionCount = sourceChunks.size + targetChunks.size - overlapCount;
        const jaccardScore = unionCount > 0 ? overlapCount / unionCount : 0;
        const cosineScore = cosineSimilarity(vectorsByTopic.get(sourceTopicId) ?? [], vectorsByTopic.get(targetTopicId) ?? []);
        const combinedScore = blendTopicSimilarity(cosineScore, jaccardScore);
        return {
          targetTopicId,
          targetName: targetMeta.name,
          overlapCount,
          jaccardScore,
          cosineScore,
          combinedScore,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((row) => row.overlapCount > 0)
      .sort((left, right) =>
        right.combinedScore - left.combinedScore
        || right.overlapCount - left.overlapCount
        || left.targetName.localeCompare(right.targetName)
      )
      .slice(0, MAX_RELATED_TOPICS);

    for (const row of scored) {
      inserts.push(
        db.prepare(
          `INSERT INTO topic_similarity_scores (
             topic_id, related_topic_id, overlap_count, jaccard_score, cosine_score, combined_score, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(
          sourceTopicId,
          row.targetTopicId,
          row.overlapCount,
          row.jaccardScore,
          row.cosineScore,
          row.combinedScore,
        )
      );
    }
  }

  if (inserts.length > 0) {
    for (let index = 0; index < inserts.length; index += 90) {
      await db.batch(inserts.slice(index, index + 90));
    }
  }

  return { topicPairsWritten: inserts.length, topicsUpdated: sourceTopicIds.length };
}
