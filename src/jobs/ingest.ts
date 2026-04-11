import { slugify } from "../lib/slug";
import { formatDate } from "../lib/date";
import { countWords } from "../lib/text";
import { extractTags } from "../services/tag-generator";
import { tokenizeForConcordance } from "../services/concordance";
import { generateEmbeddings } from "../services/embeddings";
import type { Bindings, ParsedEpisode } from "../types";

/**
 * Phase 1: Fast insert — episodes and chunks only.
 * No tags, no concordance, no embeddings. Designed for the cron path.
 */
export async function ingestEpisodesOnly(
  db: D1Database,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<{ episodesAdded: number; chunksAdded: number }> {
  let episodesAdded = 0;
  let chunksAdded = 0;

  const existing = await db.prepare(
    "SELECT published_date FROM episodes WHERE source_id = ?"
  )
    .bind(sourceId)
    .all();
  const existingDates = new Set(
    (existing.results as any[]).map((r) => r.published_date)
  );

  const source = await db.prepare("SELECT google_doc_id FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<{ google_doc_id: string }>();
  const sourceTag = source ? source.google_doc_id.substring(0, 6) : String(sourceId);

  for (const episode of episodes) {
    const dateStr = formatDate(episode.parsedDate);
    if (existingDates.has(dateStr)) continue;

    const episodeSlug = `${dateStr}-${sourceTag}`;
    const episodeResult = await db.prepare(
      `INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sourceId, episodeSlug, episode.title, dateStr,
        episode.parsedDate.getUTCFullYear(),
        episode.parsedDate.getUTCMonth() + 1,
        episode.parsedDate.getUTCDate(),
        episode.chunks.length, episode.format
      )
      .run();

    const episodeId = episodeResult.meta.last_row_id;
    episodesAdded++;

    const chunkInserts: D1PreparedStatement[] = [];
    for (const chunk of episode.chunks) {
      const baseSlug = slugify(chunk.title) || `chunk-${chunk.position}`;
      const chunkSlug = `${baseSlug}-${episodeSlug}-${chunk.position}`;
      const wordCount = countWords(chunk.contentPlain);
      const vectorId = `chunk-${episodeSlug}-${chunk.position}`;

      chunkInserts.push(
        db.prepare(
          `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count, vector_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(episodeId, chunkSlug, chunk.title, chunk.content, chunk.contentPlain, chunk.position, wordCount, vectorId)
      );
    }

    for (let i = 0; i < chunkInserts.length; i += 50) {
      await db.batch(chunkInserts.slice(i, i + 50));
    }
    chunksAdded += episode.chunks.length;
  }

  return { episodesAdded, chunksAdded };
}

/**
 * Phase 2: Enrich a batch of chunks that don't have tags yet.
 * Adds tags, chunk_tags, episode_tags, chunk_words, and rebuilds concordance.
 * Call repeatedly until isEnrichmentComplete() returns true.
 */
export async function enrichChunks(
  db: D1Database,
  batchSize: number = 50
): Promise<{ chunksProcessed: number }> {
  // Find chunks that haven't been tagged yet
  const unenriched = await db.prepare(
    `SELECT c.id, c.episode_id, c.content_plain
     FROM chunks c
     WHERE c.id NOT IN (SELECT DISTINCT chunk_id FROM chunk_tags)
     LIMIT ?`
  )
    .bind(batchSize)
    .all();

  if (!unenriched.results.length) return { chunksProcessed: 0 };

  const chunks = unenriched.results as any[];

  // Collect all tags
  const uniqueTags = new Map<string, string>();
  const chunkTagPairs: { chunkId: number; episodeId: number; tagSlug: string }[] = [];

  for (const chunk of chunks) {
    const tags = extractTags(chunk.content_plain);
    for (const tag of tags) {
      uniqueTags.set(tag.slug, tag.name);
      chunkTagPairs.push({ chunkId: chunk.id, episodeId: chunk.episode_id, tagSlug: tag.slug });
    }
  }

  // Batch: insert unique tags
  const tagInserts = [...uniqueTags.entries()].map(([slug, name]) =>
    db.prepare("INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)").bind(name, slug)
  );
  for (let i = 0; i < tagInserts.length; i += 50) {
    await db.batch(tagInserts.slice(i, i + 50));
  }

  // Batch: chunk_tags + usage_count
  const ctStmts: D1PreparedStatement[] = [];
  const usageStmts: D1PreparedStatement[] = [];
  for (const { chunkId, tagSlug } of chunkTagPairs) {
    ctStmts.push(
      db.prepare("INSERT OR IGNORE INTO chunk_tags (chunk_id, tag_id) SELECT ?, id FROM tags WHERE slug = ?")
        .bind(chunkId, tagSlug)
    );
    usageStmts.push(
      db.prepare("UPDATE tags SET usage_count = usage_count + 1 WHERE slug = ?").bind(tagSlug)
    );
  }
  for (let i = 0; i < ctStmts.length; i += 50) {
    await db.batch(ctStmts.slice(i, i + 50));
  }
  for (let i = 0; i < usageStmts.length; i += 50) {
    await db.batch(usageStmts.slice(i, i + 50));
  }

  // Batch: episode_tags
  const episodeIds = [...new Set(chunks.map((c) => c.episode_id))];
  const etStmts = episodeIds.flatMap((epId) =>
    chunks
      .filter((c) => c.episode_id === epId)
      .map((c) =>
        db.prepare(
          "INSERT OR IGNORE INTO episode_tags (episode_id, tag_id) SELECT ?, tag_id FROM chunk_tags WHERE chunk_id = ?"
        ).bind(epId, c.id)
      )
  );
  for (let i = 0; i < etStmts.length; i += 50) {
    await db.batch(etStmts.slice(i, i + 50));
  }

  // Batch: chunk_words
  const wordStmts: D1PreparedStatement[] = [];
  for (const chunk of chunks) {
    const wordCounts = tokenizeForConcordance(chunk.content_plain);
    for (const [word, count] of wordCounts) {
      wordStmts.push(
        db.prepare("INSERT OR REPLACE INTO chunk_words (chunk_id, word, count) VALUES (?, ?, ?)")
          .bind(chunk.id, word, count)
      );
    }
  }
  for (let i = 0; i < wordStmts.length; i += 50) {
    await db.batch(wordStmts.slice(i, i + 50));
  }

  // Rebuild concordance and precompute chunk reach
  await db.batch([
    db.prepare("DELETE FROM concordance"),
    db.prepare(
      `INSERT INTO concordance (word, total_count, doc_count, updated_at)
       SELECT word, SUM(count), COUNT(DISTINCT chunk_id), datetime('now')
       FROM chunk_words GROUP BY word`
    ),
  ]);

  // Precompute reach for enriched chunks
  await db.prepare(
    `UPDATE chunks SET reach = (
       SELECT COALESCE(SUM(t.usage_count), 0)
       FROM chunk_tags ct JOIN tags t ON ct.tag_id = t.id
       WHERE ct.chunk_id = chunks.id
     ) WHERE id IN (SELECT chunk_id FROM chunk_tags)`
  ).run();

  return { chunksProcessed: chunks.length };
}

/**
 * Check if all chunks have been enriched (have tags).
 */
export async function isEnrichmentComplete(db: D1Database): Promise<boolean> {
  const result = await db.prepare(
    `SELECT COUNT(*) as c FROM chunks
     WHERE id NOT IN (SELECT DISTINCT chunk_id FROM chunk_tags)`
  ).first();
  return (result as any).c === 0;
}

/**
 * Legacy: full pipeline (used by /api/ingest for manual ingestion).
 * Calls Phase 1 + Phase 2 in sequence.
 */
export async function ingestParsedEpisodes(
  env: Bindings,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<{ episodesAdded: number; chunksAdded: number }> {
  const result = await ingestEpisodesOnly(env.DB, sourceId, episodes);

  if (result.chunksAdded > 0) {
    await enrichChunks(env.DB, 10000);

    // Embeddings (optional, may fail)
    try {
      if (env.AI && env.VECTORIZE) {
        const unembed = await env.DB.prepare(
          "SELECT id, content_plain, vector_id FROM chunks WHERE vector_id IS NOT NULL LIMIT 100"
        ).all();
        if (unembed.results.length > 0) {
          const texts = (unembed.results as any[]).map((c) => c.content_plain);
          const embeddings = await generateEmbeddings(env.AI, texts);
          const vectors = (unembed.results as any[]).map((c, i) => ({
            id: c.vector_id,
            values: embeddings[i],
            metadata: { chunkId: c.id },
          }));
          await env.VECTORIZE.upsert(vectors);
        }
      }
    } catch (e) {
      console.error("Embedding error:", e);
    }
  }

  return result;
}
