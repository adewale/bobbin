# Pipeline v3: Performance, Quality, and Scaling

## Context

The enrichment pipeline processes ~6K text chunks (growing weekly). Three structural issues were identified and fixed in v2.5:
1. Noise filter moved into extractTopics (was in caller)
2. NOT IN subquery replaced with enriched flag column
3. Sentence-start capitalisation bug fixed

This spec covers the remaining improvements identified by three research agents (pipeline patterns, NLP quality, Cloudflare best practices).

## Current bottlenecks (measured)

| Bottleneck | Current | Root cause | Target |
|------------|---------|------------|--------|
| Batch size | 16 chunks/request | computeCorpusStats tokenizes all batch texts (CPU-bound) | 200 chunks/request |
| Full re-enrichment | 120 requests, ~4 min | Sequential HTTP calls, small batches | ~30 requests, ~30s |
| Phrase quality | 1/3 garbage phrases | Raw bigram counting, no statistical significance test | PMI-scored phrases |
| Keyword quality | TF-IDF with per-batch IDF (16 chunks) | IDF computed over batch, not corpus | Corpus-wide IDF from word_stats |
| D1 batch size | 50 statements per batch | Conservative default | 100 statements per batch |

## Changes

### 1. IDF from word_stats

**Problem:** `computeCorpusStats` tokenizes all batch texts in memory to compute IDF. With 16 chunks, each ~200 words, this is ~3,200 tokenizations per request. This is the CPU bottleneck that limits batch size to 16.

**Fix:** Load IDF from the existing `word_stats` table which has `doc_count` per word across the entire corpus. One D1 query replaces all per-batch tokenization.

```ts
// Before (per-batch, CPU-intensive):
const corpusStats = computeCorpusStats(chunks.map(c => c.content_plain));

// After (precomputed, one query):
const idfData = await db.prepare(
  "SELECT word, doc_count FROM word_stats WHERE doc_count >= 2"
).all();
const totalDocs = await db.prepare("SELECT COUNT(*) as c FROM chunks").first();
const corpusStats = {
  totalChunks: totalDocs.c,
  docFreq: new Map(idfData.results.map(r => [r.word, r.doc_count])),
};
```

**Impact:** Batch size increases from 16 to ~200. Full re-enrichment drops from 120 requests to ~30.

**Metric:** Measure chunks-per-request before and after.

### 2. Raise batch sizes

**Problem:** `batchExec` uses 50 statements per D1 batch. D1 has no hard cap -- the limit is 30s per batch.

**Fix:** Raise to 100 statements per batch in `src/lib/db.ts`. Raise enrichment batch default from 50 to 200 in `enrichChunks`.

**Impact:** Fewer D1 round-trips per enrichment call. ~2x fewer batch calls.

**Metric:** D1 statement count per enrichment request.

### 3. Queue fan-out for enrichment

**Problem:** Enrichment is sequential: one HTTP request processes one batch, waits for response, then next. With 30 batches at ~2s each, full re-enrichment takes ~60s.

**Fix:** Add `"enrich-batch"` message type to the queue. The `/api/enrich` endpoint (or cron handler) dispatches chunk IDs to the queue. 20 concurrent consumers process batches in parallel.

```ts
// Producer: dispatch chunk batches to queue
const unenriched = await db.prepare("SELECT id FROM chunks WHERE enriched = 0").all();
const batches = chunkArray(unenriched.results.map(r => r.id), 200);
for (const batch of batches) {
  await queue.send({ type: "enrich-batch", chunkIds: batch });
}

// Consumer: process one batch
async function handleEnrichBatch(db, chunkIds) {
  const chunks = await db.prepare(`SELECT ... WHERE id IN (...)`).all();
  // ... extractTopics, insert, markEnriched
}
```

**Config:** `max_concurrency: 20, max_batch_size: 50` in wrangler.jsonc.

**Impact:** Full re-enrichment drops from ~60s to ~10s (20x parallelism, limited by D1 write throughput).

**Metric:** Wall-clock time for full re-enrichment.

### 4. YAKE keyword extraction (alongside TF-IDF)

**Problem:** TF-IDF is a bag-of-words approach that doesn't consider word position, frequency distribution, or casing context. It produces generic keywords.

**Fix:** Add YAKE (Yet Another Keyword Extractor) as an alternative keyword extraction method. YAKE is unsupervised, corpus-independent, designed for short texts, and available as JavaScript (`yake-js` or custom implementation).

YAKE scores words by:
- Position in text (earlier = more important)
- Frequency relative to sentence count
- Casing (capitalised words in non-sentence-start position = likely entities)
- Context (words that appear with many different neighbors = less specific)

Run both extractors and compare:

```ts
export function extractTopics(
  text: string,
  maxTopics: number = 15,
  corpusStats?: CorpusStats,
  method: "tfidf" | "yake" | "both" = "tfidf"
): TopicResult[] {
  // ...
}
```

When `method = "both"`, run both extractors and merge results using reciprocal rank fusion (same technique as search). This produces a combined ranking that benefits from both approaches.

**Benchmarking:** Add a script `scripts/benchmark-extractors.sh` that:
1. Picks 100 random chunks from the corpus
2. Runs both extractors on each
3. Compares: overlap, unique finds, noise rate, entity detection rate
4. Outputs a comparison table

**Metric:** Noise rate (% of extracted topics in NOISE_WORDS), entity recall (% of known entities detected), human quality assessment on 20 random chunks.

### 5. PMI for phrase extraction

**Problem:** N-gram extraction uses raw count (appears in N+ documents). This produces garbage like "higher quality" and "pay attention" where both words are common independently.

**Fix:** Compute Pointwise Mutual Information from chunk_words:

```sql
SELECT cw1.word || ' ' || cw2.word as phrase,
       COUNT(DISTINCT cw1.chunk_id) as co_doc_count,
       LOG(
         CAST(COUNT(DISTINCT cw1.chunk_id) AS REAL) * (SELECT COUNT(*) FROM chunks) /
         ((SELECT COUNT(DISTINCT chunk_id) FROM chunk_words WHERE word = cw1.word) *
          (SELECT COUNT(DISTINCT chunk_id) FROM chunk_words WHERE word = cw2.word))
       ) as pmi
FROM chunk_words cw1
JOIN chunk_words cw2 ON cw1.chunk_id = cw2.chunk_id AND cw1.word < cw2.word
GROUP BY cw1.word, cw2.word
HAVING co_doc_count >= 5
ORDER BY pmi DESC
LIMIT 200
```

PMI > 0 means the words co-occur more than expected by chance. High PMI = genuine collocation. Low PMI = independent words that happen to be near each other.

**Impact:** Eliminates garbage phrases. "vibe coding" (high PMI: both words rare independently) ranks above "higher quality" (low PMI: both words common independently).

**Metric:** Garbage phrase rate before vs after.

### 6. Enrichment versioning

**Problem:** Changing the noise list, entity list, or extraction algorithm requires full delete-and-rebuild of all topic assignments. This is slow and error-prone.

**Fix:** Add `enrichment_version` column to chunks:

```sql
ALTER TABLE chunks ADD COLUMN enrichment_version INTEGER NOT NULL DEFAULT 0;
```

When the algorithm changes, bump `CURRENT_ENRICHMENT_VERSION` in the code. The enrichment query becomes:

```ts
WHERE enriched = 0 OR enrichment_version < CURRENT_ENRICHMENT_VERSION
```

This re-enriches chunks with outdated versions without deleting their existing topic assignments first.

**Impact:** Algorithm changes apply incrementally. No full rebuild needed.

**Metric:** Time to apply a noise list change across the corpus.

### 7. Workflow migration (future, when needed)

**Problem:** The cron handler has a 15-minute wall-clock limit. As the corpus grows, enrichment + finalization may exceed this.

**Fix:** Replace the cron handler with a Cloudflare Workflow. The cron creates a Workflow instance, each pipeline stage is a durable step with unlimited total duration and per-step retry.

**Trigger:** When enrichment takes > 10 minutes in the cron handler.

**Impact:** Unlimited pipeline duration. Per-step retry. Observable in CF dashboard.

## Implementation order

| Priority | Change | Effort | Measurable impact |
|----------|--------|--------|-------------------|
| 1 | IDF from word_stats | 1 hour | Batch size 16 -> 200 (12x) |
| 2 | Raise batch sizes | 10 min | D1 round-trips halved |
| 3 | Queue fan-out | 2 hours | Re-enrichment 60s -> 10s |
| 4 | YAKE extraction | 3 hours | Benchmark vs TF-IDF quality |
| 5 | PMI phrases | 2 hours | Garbage phrase rate -> 0 |
| 6 | Enrichment versioning | 1 hour | Incremental algorithm updates |
| 7 | Workflow migration | 3 hours | Unlimited duration (future) |

## Verification

Each change includes:
- RED test written before implementation
- GREEN implementation
- Before/after metrics captured
- PBT for any function processing arbitrary input

Full re-enrichment (`./scripts/run-enrichment.sh SECRET --full`) must work after each change. The enrichment script is the acceptance test for the pipeline.
