# Enrichment Pipeline Optimization: Research and Recommendations

Research for the Bobbin project's NLP enrichment pipeline running on Cloudflare Workers + D1 + Queues.

## Current Architecture Summary

The pipeline has three phases: (1) fast insert of episodes/chunks, (2) batch enrichment (topic extraction, word stats), and (3) finalization (usage counts, related slugs, n-grams, cleanup). The enrichment phase calls `enrichChunks` in a loop via `enrichAllChunks`, processing batches until a time budget expires. Finalization dispatches slow work (n-gram assignment, related_slugs) to a Cloudflare Queue.

## Problem 1: `getUnenrichedChunks` Uses NOT IN Subquery

**Current code** (`src/db/ingestion.ts:24-31`):
```sql
SELECT c.id, c.episode_id, c.content_plain FROM chunks c
WHERE c.id NOT IN (SELECT DISTINCT chunk_id FROM chunk_topics) LIMIT ?
```

This scans the entire `chunk_topics` table on every call. With 6K chunks and growing topic assignments, this gets progressively slower.

**Recommended fix: Add an `enriched` flag column to `chunks`.**

A boolean column `enriched INTEGER NOT NULL DEFAULT 0` with an index `idx_chunks_unenriched ON chunks(enriched) WHERE enriched = 0` (partial index) turns this into a trivial indexed lookup. Set `enriched = 1` at the end of `enrichChunks` for each processed batch. The partial index stays small (only unenriched rows) and shrinks as enrichment progresses.

Alternative: `LEFT JOIN chunk_topics ct ON c.id = ct.chunk_id WHERE ct.chunk_id IS NULL` performs better than NOT IN on SQLite because it avoids materializing the subquery result, but the flag column is simpler and also eliminates the join entirely.

**Estimated impact**: Query drops from O(chunk_topics rows) to O(unenriched chunks). At 6K chunks this saves ~50-100ms per batch call; at 20K+ chunks the savings compound.

## Problem 2: IDF Computed Per-Batch, Not Corpus-Wide

**Current code** (`src/jobs/ingest.ts:85`):
```ts
const corpusStats = computeCorpusStats(chunks.map(c => c.content_plain));
```

This computes IDF over just the current batch (e.g. 50-200 chunks), not the full corpus. A word appearing in 2/50 batch chunks gets a very different IDF than 2/6000 corpus chunks.

**Recommended fix: Use the existing `word_stats` table as a precomputed IDF source.**

The `word_stats` table already has `doc_count` per word and the total chunk count is a single `SELECT COUNT(*)`. Build `CorpusStats` from `word_stats` instead of recomputing from raw text:

```ts
async function loadCorpusStats(db: D1Database): Promise<CorpusStats> {
  const total = await db.prepare("SELECT COUNT(*) as c FROM chunks").first();
  const rows = await db.prepare("SELECT word, doc_count FROM word_stats").all();
  const docFreq = new Map(rows.results.map(r => [r.word, r.doc_count]));
  return { totalChunks: total.c, docFreq };
}
```

For the very first enrichment run (empty word_stats), fall back to batch-local IDF -- this is the cold-start case and accuracy matters less. After the first finalization rebuilds word_stats, all subsequent enrichment uses corpus-wide IDF.

**Recomputation schedule**: Rebuild word_stats during finalization (already happens). For incremental ingestion (weekly cron adding 1-2 episodes), the existing word_stats from last week is a good-enough IDF approximation. Full recompute only needed when >20% of corpus is new.

**Estimated impact**: Better topic quality (terms common corpus-wide like "software" get properly suppressed), and eliminates the CPU cost of tokenizing the entire batch twice (once for IDF, once for word stats).

## Problem 3: Batch Size Limited to ~16 by CPU Cost

The 30-second CPU limit constrains how many chunks can be processed per invocation. The bottleneck is per-chunk work: tokenization, entity detection, TF-IDF scoring, and generating D1 statements.

**Recommended fixes (layered)**:

1. **Eliminate redundant tokenization.** Currently each chunk is tokenized in `extractTopics` (for TF), `extractEntities` (splits on whitespace), and `tokenizeForWordStats`. Share a single tokenization pass.

2. **Move to queue-per-chunk for enrichment.** Instead of `enrichAllChunks` looping in a single Worker invocation, dispatch each batch of chunk IDs as a queue message. The queue consumer config already allows `max_concurrency: 10` -- this gives 10x parallelism. A new message type `"enrich-batch"` with a list of chunk IDs would process 50 chunks per message, with 10 messages in flight = 500 chunks concurrent. At 6K chunks, that is 12 messages total, completing in 2-3 queue cycles (~30 seconds wall time vs 4 minutes sequential).

3. **Reduce D1 round-trips.** The current code does 4 separate `batchExec` calls per enrichment batch (topic inserts, entity updates, chunk_topics, chunk_words). Merge these into fewer `db.batch()` calls. D1 supports up to 100 statements per batch; combine topic inserts + chunk_topics into one batch where possible.

4. **Precompute noise filtering in extractTopics.** Currently `isNoiseTopic` is called both inside `enrichChunks` (at insert time) and in `getChunkTopics` (at read time). Moving it entirely into `extractTopics` means fewer topics generated, fewer D1 statements, and no caller-side filtering.

## Problem 4: Full Re-enrichment Strategy

**When to trigger full re-enrichment:**
- Schema changes (new noise words added to `topic-quality.ts`, new entities in `known-entities.ts`)
- Algorithm changes (new entity detection heuristics, TF-IDF formula changes)
- Data quality issues discovered (e.g., a bug in normalization)

**Recommended pattern: Dirty-flag with selective re-enrichment.**

Add an `enrichment_version INTEGER NOT NULL DEFAULT 0` column to `chunks`. Bump a constant `CURRENT_ENRICHMENT_VERSION` when the algorithm changes. The `getUnenrichedChunks` query becomes: `WHERE enriched = 0 OR enrichment_version < ?`. This avoids delete-and-rebuild (which would lose the `chunk_topics` data during the rebuild window) and naturally integrates with the existing batch loop.

For noise word list changes specifically: a finalization-only pass suffices. The existing `finalizeEnrichment` already deletes chunk_topics for noise topics. Adding a new noise word just requires re-running finalization, not re-enrichment.

## Problem 5: Optimal Pipeline Architecture for This Scale

At 1K-100K documents on Cloudflare Workers, the right pattern is a **staged pipeline with queue fan-out**:

**Stage 1 (Cron trigger):** Fetch + parse + insert (current `ingestEpisodesOnly`). Fast, runs in a single Worker invocation.

**Stage 2 (Queue fan-out):** Dispatch enrichment batches to the queue. Each message contains 50-100 chunk IDs. Queue processes with `max_concurrency: 10`. Each consumer loads corpus IDF from `word_stats`, processes its batch, writes results.

**Stage 3 (Queue aggregation):** After all enrichment messages are processed, dispatch a single `"finalize"` message. This runs usage count recalculation, word_stats rebuild, n-gram extraction, and related_slugs computation.

**How to know when Stage 2 is complete:** Use a counter. Before dispatching, write `enrichment_pending = N` to a metadata row. Each consumer decrements it. When it hits 0, the consumer dispatches the finalize message. Alternatively, use D1 to track: `SELECT COUNT(*) FROM chunks WHERE enriched = 0` -- if 0, dispatch finalize.

**Comparison with other systems:**
- Elasticsearch re-indexes documents independently (no cross-document IDF during indexing; IDF is computed at query time from shard statistics). This is the closest analogy -- Bobbin could defer IDF to query time or use precomputed stats.
- Prefect/Airflow use DAG-based orchestration which is overkill here. The queue already provides retry semantics and concurrency control.
- Apache NiFi uses backpressure-aware queues between processors -- Cloudflare Queues provide this natively with `max_batch_size` and `max_concurrency`.

## Priority-Ordered Action Plan

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Add `enriched` flag column, replace NOT IN query | Small | Eliminates O(n) scan per batch |
| 2 | Load IDF from `word_stats` instead of per-batch compute | Small | Better topic quality + less CPU |
| 3 | Move noise filter into `extractTopics` | Small | Fewer D1 writes, cleaner API |
| 4 | Queue fan-out for enrichment batches | Medium | 10x parallelism, ~30s vs ~4min |
| 5 | Add `enrichment_version` for selective re-enrichment | Small | Avoids full rebuild on algorithm changes |
| 6 | Merge D1 batch calls + share tokenization | Medium | ~2x more chunks per CPU budget |

Items 1-3 are low-risk, high-reward changes that can be done independently. Item 4 is the biggest architectural change but uses infrastructure (Queues) already configured in `wrangler.jsonc`.
