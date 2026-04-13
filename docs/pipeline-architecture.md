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

   For each unenriched chunk:
     a. decodeHtmlEntities (normalize curly quotes)                    O(1)
     b. extractTopics(text, 15, corpusStats)                          O(words)
        - extractKnownEntities (curated list match)
        - extractEntities (capitalization heuristics)
        - TF-IDF keywords (with corpus IDF)
     c. isNoiseTopic filter at INSERT time                            O(1)
     d. INSERT topics, chunk_topics, episode_topics                   O(topics)
     e. tokenizeForWordStats -> INSERT chunk_words                    O(words)

   SCALING NOTE: extractTopics does TF-IDF per chunk. computeCorpusStats
   scans all chunk texts in the current batch to compute IDF. At 50K chunks,
   this should be precomputed into word_stats instead of per-batch.

  |
  v
5. FINALIZE ENRICHMENT ------------------------------------------------ mixed
   finalizeEnrichment(db, queue)

   FAST STEPS (inline, < 5s total):
   a. Recalculate usage_count ---- 1 SQL UPDATE ---------------------- O(1)
   b. Rebuild word_stats --------- 2 SQL (DELETE + UPSERT) ----------- O(1)
   c. Precompute reach ----------- 1 SQL UPDATE ---------------------- O(1)
   d. Merge co-occurring topics -- 5 hardcoded rules ----------------- O(1)
   e. Precompute distinctiveness - 1 SQL UPDATE ---------------------- O(1)

   SLOW STEPS (dispatched to QUEUE when available, inline fallback):
   f. N-gram extraction
      extractCorpusNgrams(allTexts) -- in-memory, fast
      Then per discovered phrase: LIKE scan to find matching chunks
      SCALING: O(phrases x chunks). 100 phrases x 50K chunks = 5M row scans.
      With queue: 100 messages, 10 concurrent consumers, ~10s wall clock.
      Without queue: ~30-60s serial. Times out at >120s.

   g. Related slugs
      Per topic (usage >= 3): co-occurrence JOIN + UPDATE
      SCALING: O(topics). N+1 pattern. 6K topics = 6K queries.
      With queue: 6K messages, 10 concurrent consumers, ~6s wall clock.
      Without queue: ~60s serial. Times out at >3K topics.

   CLEANUP STEPS (inline, < 5s total):
   h. Entity validation ---------- DELETE false chunk_topics --------- O(entities)
   i. Noise cleanup -------------- DELETE noise chunk_topics ---------- O(noise_words)
   j. Usage recalculation -------- 1 SQL UPDATE ---------------------- O(1)
   k. Prune usage<=1 ------------- DELETE + UPDATE (exempt entities) -- O(1)
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
