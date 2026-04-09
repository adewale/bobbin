import { slugify } from "../lib/slug";
import { formatDate } from "../lib/date";
import { countWords } from "../lib/text";
import { extractTags } from "../services/tag-generator";
import { tokenizeForConcordance } from "../services/concordance";
import { generateEmbedding } from "../services/embeddings";
import { generateSummary } from "../services/summarizer";
import type { Bindings, ParsedEpisode } from "../types";

export async function ingestParsedEpisodes(
  env: Bindings,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<{ episodesAdded: number; chunksAdded: number }> {
  let episodesAdded = 0;
  let chunksAdded = 0;

  const existing = await env.DB.prepare(
    "SELECT published_date FROM episodes WHERE source_id = ?"
  )
    .bind(sourceId)
    .all();
  const existingDates = new Set(
    (existing.results as any[]).map((r) => r.published_date)
  );

  for (const episode of episodes) {
    const dateStr = formatDate(episode.parsedDate);
    if (existingDates.has(dateStr)) continue;

    const episodeSlug = dateStr;
    const episodeResult = await env.DB.prepare(
      `INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sourceId,
        episodeSlug,
        episode.title,
        dateStr,
        episode.parsedDate.getUTCFullYear(),
        episode.parsedDate.getUTCMonth() + 1,
        episode.parsedDate.getUTCDate(),
        episode.chunks.length
      )
      .run();

    const episodeId = episodeResult.meta.last_row_id;
    episodesAdded++;

    // Prepare all chunk data upfront
    const chunkInserts: D1PreparedStatement[] = [];
    const chunkMeta: { slug: string; title: string; plain: string; position: number; vectorId: string }[] = [];

    for (const chunk of episode.chunks) {
      const baseSlug = slugify(chunk.title) || `chunk-${chunk.position}`;
      const chunkSlug = `${baseSlug}-${episodeSlug}-${chunk.position}`;
      const wordCount = countWords(chunk.contentPlain);
      const vectorId = `chunk-${episodeSlug}-${chunk.position}`;

      chunkInserts.push(
        env.DB.prepare(
          `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count, vector_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(episodeId, chunkSlug, chunk.title, chunk.content, chunk.contentPlain, chunk.position, wordCount, vectorId)
      );
      chunkMeta.push({ slug: chunkSlug, title: chunk.title, plain: chunk.contentPlain, position: chunk.position, vectorId });
    }

    // Batch insert all chunks (groups of 50)
    const chunkIds: number[] = [];
    for (let i = 0; i < chunkInserts.length; i += 50) {
      const batchResults = await env.DB.batch(chunkInserts.slice(i, i + 50));
      for (const r of batchResults) {
        chunkIds.push(r.meta.last_row_id);
      }
    }
    chunksAdded += chunkIds.length;

    // Batch: collect all tags across all chunks, insert unique ones
    const allTagSets: { chunkIdx: number; tags: { name: string; slug: string }[] }[] = [];
    const uniqueTags = new Map<string, string>(); // slug -> name

    for (let i = 0; i < chunkMeta.length; i++) {
      const tags = extractTags(chunkMeta[i].plain);
      allTagSets.push({ chunkIdx: i, tags });
      for (const t of tags) {
        uniqueTags.set(t.slug, t.name);
      }
    }

    // Insert all unique tags in one batch
    const tagInserts = [...uniqueTags.entries()].map(([slug, name]) =>
      env.DB.prepare("INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)").bind(name, slug)
    );
    for (let i = 0; i < tagInserts.length; i += 50) {
      await env.DB.batch(tagInserts.slice(i, i + 50));
    }

    // Batch: chunk_tags and usage_count updates
    const chunkTagStmts: D1PreparedStatement[] = [];
    const usageStmts: D1PreparedStatement[] = [];

    for (const { chunkIdx, tags } of allTagSets) {
      const chunkId = chunkIds[chunkIdx];
      for (const tag of tags) {
        chunkTagStmts.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO chunk_tags (chunk_id, tag_id) SELECT ?, id FROM tags WHERE slug = ?"
          ).bind(chunkId, tag.slug)
        );
        usageStmts.push(
          env.DB.prepare("UPDATE tags SET usage_count = usage_count + 1 WHERE slug = ?").bind(tag.slug)
        );
      }
    }

    for (let i = 0; i < chunkTagStmts.length; i += 50) {
      await env.DB.batch(chunkTagStmts.slice(i, i + 50));
    }
    for (let i = 0; i < usageStmts.length; i += 50) {
      await env.DB.batch(usageStmts.slice(i, i + 50));
    }

    // Batch: episode_tags
    const episodeTagStmts = chunkIds.map((chunkId) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO episode_tags (episode_id, tag_id) SELECT ?, tag_id FROM chunk_tags WHERE chunk_id = ?"
      ).bind(episodeId, chunkId)
    );
    for (let i = 0; i < episodeTagStmts.length; i += 50) {
      await env.DB.batch(episodeTagStmts.slice(i, i + 50));
    }

    // Batch: concordance (chunk_words)
    const wordStmts: D1PreparedStatement[] = [];
    for (let i = 0; i < chunkMeta.length; i++) {
      const wordCounts = tokenizeForConcordance(chunkMeta[i].plain);
      for (const [word, count] of wordCounts) {
        wordStmts.push(
          env.DB.prepare("INSERT OR REPLACE INTO chunk_words (chunk_id, word, count) VALUES (?, ?, ?)")
            .bind(chunkIds[i], word, count)
        );
      }
    }
    for (let i = 0; i < wordStmts.length; i += 50) {
      await env.DB.batch(wordStmts.slice(i, i + 50));
    }

    // AI operations (embeddings, summaries) — skip silently if unavailable
    try {
      if (env.AI && env.VECTORIZE) {
        const vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[] = [];
        for (let i = 0; i < chunkMeta.length; i++) {
          const embedding = await generateEmbedding(env.AI, chunkMeta[i].plain);
          vectors.push({
            id: chunkMeta[i].vectorId,
            values: embedding,
            metadata: { chunkId: chunkIds[i], episodeSlug, title: chunkMeta[i].title },
          });
        }
        // Vectorize upsert supports batches
        if (vectors.length > 0) {
          await env.VECTORIZE.upsert(vectors);
        }
      }
    } catch {
      // AI/Vectorize may not be available
    }

    try {
      if (env.AI) {
        const chunkTexts = chunkMeta.map((c) => c.plain).join(" ");
        const summary = await generateSummary(env.AI, chunkTexts);
        await env.DB.prepare("UPDATE episodes SET summary = ? WHERE id = ?")
          .bind(summary, episodeId)
          .run();
      }
    } catch {
      // AI may not be available
    }
  }

  // Rebuild concordance aggregates
  await env.DB.batch([
    env.DB.prepare("DELETE FROM concordance"),
    env.DB.prepare(
      `INSERT INTO concordance (word, total_count, doc_count, updated_at)
       SELECT word, SUM(count), COUNT(DISTINCT chunk_id), datetime('now')
       FROM chunk_words GROUP BY word`
    ),
  ]);

  return { episodesAdded, chunksAdded };
}
