Enrichment Pipeline Architecture

## Pipeline flow

```
WEEKLY CRON (Mon 6am UTC, 15 min budget on paid plan)
  |
  v
1. FETCH NEW CONTENT ------------------------------------------------- O(1)
   fetchGoogleDoc(docId)
   HTTP GET docs.google.com/d/{id}/mobilebasic
   Returns HTML. One request per source doc.

  |
  v
2. PARSE HTML -> EPISODES + CHUNKS ----------------------------------- O(html_size)
   parseHtmlDocument(html)
   Margin-left based chunking, format detection (essays vs notes).
   ~70 chunks per episode. In-memory, fast.

  |
  v
3. INSERT EPISODES + CHUNKS (Phase 1) -------------------------------- O(new_chunks)
   ingestEpisodesOnly(db, sourceId, episodes)
   INSERT episodes + chunks. Skips existing dates (dedup by published_date).
   Batches of 50 D1 statements. Only inserts new data.

  |
  v
4. ENRICH CHUNKS (Phase 2) ------------------------------------------- O(chunks x topics_per_chunk)
   enrichAllChunks(db, 200, 120000)
   Loops with 2-min time budget, processes batches of unenriched chunks.

   For each unenriched chunk batch (processChunkBatch):
     a. DELETE old chunk_topics for batch (clean slate on re-enrichment)
     b. extractTopics(text, 5)                                        O(words)
        - extractKnownEntities (curated list, always included)
        - extractEntities (capitalization heuristics, noise-filtered)
        - YAKE keyphrases (within-document features, replaces TF-IDF)
     c. isNoiseTopic filter (250+ words, suffix heuristics, phrase rules)
     d. INSERT topics, chunk_topics, episode_topics                   O(topics)
     e. tokenizeForWordStats -> INSERT chunk_words                    O(words)

   NOTE: YAKE is per-document — no corpus stats needed. 5 keyphrases/chunk
   (was 10-15 with TF-IDF). Multi-word phrases extracted naturally.

  |
  v
5. FINALIZE ENRICHMENT (18 steps, ~3s total) ------------------------- mixed
   finalizeEnrichment(db, queue)
   All steps are resilient (continue on error, report per-step timing).

   DATA MIGRATION:
   0a. Fix topic names ----------- decode HTML entities, strip apostrophes
   0b. Early orphan purge -------- DELETE topics with no chunk_topics

   CORE AGGREGATION (batched by actual row IDs):
   1. Recalculate usage_count ---- batched UPDATE by topic IDs -------- O(topics)
   2. Rebuild word_stats --------- DELETE orphans + UPSERT ------------ O(words)
   3. Precompute reach ----------- batched UPDATE by chunk IDs -------- O(chunks)
   4. Merge co-occurring topics -- 5 hardcoded rules ----------------- O(1)
   5. N-gram extraction ---------- dispatched to queue or inline ------ O(phrases)
   6. Precompute distinctiveness - batched UPDATE by topic IDs -------- O(topics)
   7. Related slugs -------------- batch SQL or queue fallback -------- O(topics)

   CLEANUP:
   8. Entity validation ---------- DELETE false chunk_topics ---------- O(entities)
   9. Noise cleanup -------------- batched IN-clause DELETEs --------- O(noise)
   10. Usage recalculation ------- batched by actual IDs -------------- O(topics)

   QUALITY GATES (corpus-wide, Yang & Pedersen 1997):
   11. df≥5 gate ----------------- prune topics appearing in <5 chunks  O(topics)
   12. Stem merge ---------------- merge inflectional variants -------- O(active)
   13. Similarity cluster -------- Dice coefficient ≥0.7 ------------- O(active²)
   14. Final usage recount ------- batched by actual IDs -------------- O(topics)
   15. Delete orphans ------------ remove usage=0 non-entity topics --- O(orphans)
   16. Phrase dedup --------------- merge plural variants ------------- O(active)
```

## Queue architecture

```
Queue: bobbin-enrichment
  max_batch_size: 10
  max_concurrency: 10
  max_retries: 2
  Cost: free tier (< 10K ops/day)

Message types:
  "compute-related" { topicId: number }  -- compute related_slugs for 1 topic
  "assign-ngram"    { phrase: string }   -- create phrase topic + assign to chunks

Consumer: queue() handler in src/index.tsx
  Processes batches of 10 messages concurrently.
  Each message does 1-2 D1 queries + 1 UPDATE.
  Automatic retry on failure (max 2 retries).

Fallback: when no queue binding (tests, dev, pre-queue deploy),
  all slow steps run inline serial. Works but may timeout at scale.
```

## Scaling characteristics

| Component | Current (6K chunks) | At 10x (50K chunks) | Bottleneck? |
|-----------|:---:|:---:|:---:|
| Fetch HTML | 1 req/week | 1 req/week | No |
| Parse HTML | ~200KB | ~2MB | No |
| Insert chunks | ~70/week | ~700/week | No |
| extractTopics per chunk | 15 topics x 70 | 15 x 700 | Watch: IDF batch scan |
| Noise filter at insert | O(1) per topic | O(1) | No |
| word_stats rebuild | 1 SQL | 1 SQL | No |
| N-gram LIKE scans (queue) | 100 x 6K = ~10s | 100 x 50K = ~60s | Yes: needs FTS index |
| N-gram LIKE scans (no queue) | 100 x 6K = ~30s | Times out | Breaks without queue |
| Related slugs (queue) | 6K msgs, ~6s | 30K msgs, ~30s | Watch: may need +concurrency |
| Related slugs (no queue) | 6K serial, ~60s | Times out | Breaks without queue |
| Entity validation | 26 LIKE scans | 30 LIKE scans | No |
| Prune usage<=1 | 1 SQL | 1 SQL | No |

## Cost

| Service | Usage | Monthly cost |
|---------|-------|:---:|
| Workers (paid plan) | ~100 requests + cron | $5.00 |
| D1 | ~5M rows read/week | Free tier |
| Queue | ~7K operations/week | Free tier |
| Vectorize | 6K vectors | Included |
| AI | Embedding generation | Included |
| Total | | $5.00/mo |

## When to upgrade

| Trigger | Current | Upgrade path |
|---------|---------|-------------|
| N-gram LIKE scans > 60s | ~10s with queue | Add FTS index for phrase matching |
| Related slugs > 30K topics | 6K | Increase queue max_concurrency to 50 |
| Corpus > 50K chunks | 6K | Precompute IDF in word_stats, not per-batch |
| Cron > 15 min wall clock | ~3 min | Switch to Workflows (unlimited duration) |
| Need real-time enrichment | Weekly batch | Workflow triggered on content change |

## Production state

The queue is deployed (bobbin-enrichment, 1 producer, 1 consumer).
Finalization dispatches slow steps to the queue when triggered via cron
or /api/finalize. The queue processes messages in parallel (10 concurrent).

Note: the queue is NOT available in wrangler dev --remote mode. Testing
queue behavior requires deploying and triggering via the live endpoint
or cron.

## Extractor tuning

Bobbin's runtime-switchable Yaket integration and Bobbin-specific tuning profile
are documented in [yaket-bobbin-tuning.md](./yaket-bobbin-tuning.md).
