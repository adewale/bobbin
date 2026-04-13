Enrichment Pipeline Architecture

## Pipeline flow

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                    WEEKLY CRON                           │
                    │                   (Mon 6am UTC)                          │
                    │                  15 min budget                           │
                    └────────────────────────┬─────────────────────────────────┘
                                             │
                    ┌────────────────────────▼─────────────────────────────────┐
                    │              1. FETCH NEW CONTENT                        │
                    │                                                         │
                    │  fetchGoogleDoc(docId)                                   │
                    │  → HTTP GET docs.google.com/d/{id}/mobilebasic          │
                    │  → returns HTML                                         │
                    │                                                         │
                    │  ⚡ Scales: O(1) — one HTTP request per source doc      │
                    └────────────────────────┬─────────────────────────────────┘
                                             │
                    ┌────────────────────────▼─────────────────────────────────┐
                    │              2. PARSE HTML → EPISODES + CHUNKS           │
                    │                                                         │
                    │  parseHtmlDocument(html)                                 │
                    │  → margin-left based chunking                            │
                    │  → format detection (essays vs notes)                    │
                    │  → ~70 chunks per episode                                │
                    │                                                         │
                    │  ⚡ Scales: O(html_size) — in-memory, fast              │
                    └────────────────────────┬─────────────────────────────────┘
                                             │
                    ┌────────────────────────▼─────────────────────────────────┐
                    │              3. INSERT EPISODES + CHUNKS (Phase 1)       │
                    │                                                         │
                    │  ingestEpisodesOnly(db, sourceId, episodes)              │
                    │  → INSERT episodes, INSERT chunks                        │
                    │  → skips existing dates (dedup by published_date)        │
                    │  → batches of 50 D1 statements                          │
                    │                                                         │
                    │  ⚡ Scales: O(new_chunks) — only inserts new data       │
                    └────────────────────────┬─────────────────────────────────┘
                                             │
                    ┌────────────────────────▼─────────────────────────────────┐
                    │              4. ENRICH CHUNKS (Phase 2)                  │
                    │              enrichAllChunks(db, 200, 120000)            │
                    │                                                         │
                    │  For each unenriched chunk:                              │
                    │    a. decodeHtmlEntities (normalize curly quotes)        │
                    │    b. extractTopics(text, 15, corpusStats)               │
                    │       ├── extractKnownEntities (curated list match)      │
                    │       ├── extractEntities (capitalization heuristics)    │
                    │       └── TF-IDF keywords (with corpus IDF)             │
                    │    c. isNoiseTopic filter (at INSERT time)               │
                    │    d. INSERT topics, chunk_topics, episode_topics        │
                    │    e. tokenizeForWordStats → INSERT chunk_words          │
                    │                                                         │
                    │  ⚠️ Scales: O(unenriched_chunks × topics_per_chunk)     │
                    │  Each chunk generates ~15 topics → ~15 INSERTs.         │
                    │  For 70 new chunks: ~1,050 topic INSERTs.               │
                    │  With time budget, loops until done or budget exhausted. │
                    │                                                         │
                    │  🐌 Bottleneck at scale: extractTopics does TF-IDF      │
                    │  per chunk. At 50K chunks, the corpus IDF computation   │
                    │  (computeCorpusStats) scans all chunk texts in batch.   │
                    └────────────────────────┬─────────────────────────────────┘
                                             │
           ┌─────────────────────────────────▼──────────────────────────────────────┐
           │                    5. FINALIZE ENRICHMENT                               │
           │                    finalizeEnrichment(db, queue)                        │
           │                                                                        │
           │  FAST STEPS (inline, < 5s total):                                      │
           │  ┌─────────────────────────────────────────────────────────────────┐    │
           │  │ a. Recalculate usage_count    — 1 SQL UPDATE          ⚡ O(1)  │    │
           │  │ b. Rebuild word_stats         — 2 SQL (DELETE + UPSERT) ⚡ O(1)│    │
           │  │ c. Precompute reach           — 1 SQL UPDATE          ⚡ O(1)  │    │
           │  │ d. Merge co-occurring topics  — 5 rules, ~5 queries   ⚡ O(1)  │    │
           │  │ e. Precompute distinctiveness  — 1 SQL UPDATE          ⚡ O(1)  │    │
           │  └─────────────────────────────────────────────────────────────────┘    │
           │                                                                        │
           │  SLOW STEPS (dispatched to queue for parallel processing):             │
           │  ┌─────────────────────────────────────────────────────────────────┐    │
           │  │ f. N-gram extraction                                            │    │
           │  │    extractCorpusNgrams(allTexts)  — in-memory, fast             │    │
           │  │    Then: 1 message per phrase → queue "assign-ngram"            │    │
           │  │    Consumer: INSERT topic + LIKE scan + INSERT chunk_topics     │    │
           │  │                                                                 │    │
           │  │    🐌 Bottleneck: LIKE '%phrase%' scans ALL chunks per phrase   │    │
           │  │    At 100 phrases × 50K chunks = 5M row scans.                 │    │
           │  │    Mitigated: runs in parallel (10 concurrent consumers).       │    │
           │  │    With queue: ~100 messages, ~10s total.                       │    │
           │  │    Without queue: ~30-60s serial.                               │    │
           │  ├─────────────────────────────────────────────────────────────────┤    │
           │  │ g. Related slugs                                                │    │
           │  │    1 message per topic (usage >= 3) → queue "compute-related"   │    │
           │  │    Consumer: co-occurrence JOIN + UPDATE                        │    │
           │  │                                                                 │    │
           │  │    🐌 Bottleneck: N+1 pattern — 1 JOIN per topic.              │    │
           │  │    At 6K topics: 6K queries serial = ~60s.                      │    │
           │  │    With queue: ~6K messages / 10 concurrent = ~6s.              │    │
           │  │    Without queue: times out at 120s for > 3K topics.            │    │
           │  └─────────────────────────────────────────────────────────────────┘    │
           │                                                                        │
           │  CLEANUP STEPS (inline, < 5s total):                                   │
           │  ┌─────────────────────────────────────────────────────────────────┐    │
           │  │ h. Entity validation — DELETE false chunk_topics     ⚡ O(entities)│ │
           │  │ i. Noise cleanup     — DELETE noise chunk_topics     ⚡ O(noise)   │ │
           │  │ j. Usage recalc      — 1 SQL UPDATE                 ⚡ O(1)       │ │
           │  │ k. Prune usage≤1     — DELETE + UPDATE              ⚡ O(1)       │ │
           │  └─────────────────────────────────────────────────────────────────┘    │
           └────────────────────────────────────────────────────────────────────────┘

                                    Queue: bobbin-enrichment
                            ┌───────────────────────────────────┐
                            │  max_batch_size: 10               │
                            │  max_concurrency: 10              │
                            │  max_retries: 2                   │
                            │  Cost: free (< 10K ops/day)       │
                            └───────────────────────────────────┘
```

## Scaling characteristics

| Component | Current load | At 10x (500 episodes, 50K chunks) | Bottleneck? |
|-----------|:---:|:---:|:---:|
| Fetch HTML | 1 req/week | 1 req/week | No |
| Parse HTML | ~200KB | ~2MB | No |
| Insert chunks | ~70/week | ~700/week | No |
| extractTopics per chunk | 15 topics × 70 chunks | 15 × 700 | ⚠️ IDF computation grows |
| Noise filter at insert | O(1) per topic | O(1) | No |
| word_stats rebuild | 1 SQL | 1 SQL | No |
| N-gram LIKE scans | 100 × 6K rows | 100 × 50K rows | 🐌 Needs FTS or index |
| Related slugs (with queue) | 6K msgs / 10 concurrent | 30K msgs / 10 concurrent | ⚠️ May need higher concurrency |
| Related slugs (without queue) | 6K serial queries | Times out | 🔴 Breaks |
| Entity validation | 26 LIKE scans | 26 LIKE scans | No |
| Prune usage≤1 | 1 SQL | 1 SQL | No |

## Cost at current scale

| Service | Usage | Monthly cost |
|---------|-------|:---:|
| Workers (paid plan) | ~100 requests + cron | $5.00 |
| D1 | ~5M rows read/week | Free tier |
| Queue | ~7K operations/week | Free tier |
| Vectorize | 6K vectors | Included |
| AI | Embedding generation | Included |
| **Total** | | **$5.00/mo** |

## When to upgrade

| Trigger | Current | Upgrade path |
|---------|---------|-------------|
| N-gram LIKE scans > 30s | 100 × 6K = 10s | Add FTS index for phrase matching |
| Related slugs > 10K topics | 6K | Increase queue concurrency to 50 |
| Corpus > 50K chunks | 6K | Precompute IDF in word_stats table instead of per-batch |
| Cron > 15 min | ~3 min | Switch to Workflows (unlimited duration) |
| Need real-time enrichment | Weekly batch | Workflow triggered by fetch |

## Fallback behavior

Every slow step has a fallback when no queue is available:
- Tests: inline serial processing (no queue binding in test env)
- Local dev: inline serial processing
- Production without queue: inline (may timeout for related_slugs at > 3K topics)
- Production with queue: parallel processing, completes in seconds
