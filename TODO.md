# TODO

## Done (this session)
- [x] Full-sentence titles (no truncation)
- [x] Topic tiers (People & Phrases / Key Concepts) -> replaced with small multiples grid
- [x] Concordance visualization -> merged into /topics
- [x] Reading flow (accordion episodes, prev/next on chunks, "more on this topic")
- [x] Tags -> Topics migration (9 phases)
- [x] Entity detection (curated list + heuristic capitalisation)
- [x] N-gram phrase extraction
- [x] Topic-aware search (topic: operator, entity alias expansion, vector threshold)
- [x] Queue-based finalization (n-gram + related_slugs parallelized)
- [x] Wide event logging for cron and queue
- [x] Dead code removal (-197 lines)
- [x] Noise filter moved into extractTopics
- [x] NOT IN subquery replaced with enriched flag column
- [x] Sentence-start entity bug fixed

## Pipeline v3 (from specs/pipeline-v3.md)

### Ready to implement
- [ ] **IDF from word_stats** — load corpus-wide IDF from word_stats.doc_count instead of per-batch computeCorpusStats. Increases batch size from 16 to ~200. See specs/pipeline-v3.md section 1.
- [ ] **Raise batch sizes** — batchExec from 50 to 100 statements. enrichChunks default from 50 to 200. See specs/pipeline-v3.md section 2.
- [ ] **Queue fan-out for enrichment** — dispatch chunk batches to queue for parallel processing. max_concurrency 20. See specs/pipeline-v3.md section 3.
- [ ] **PMI for phrase extraction** — replace raw bigram counting with Pointwise Mutual Information from chunk_words. See specs/pipeline-v3.md section 5.
- [ ] **Enrichment versioning** — enrichment_version column on chunks for incremental re-enrichment. See specs/pipeline-v3.md section 6.
- [ ] **Raise queue concurrency** — max_concurrency from 10 to 20, max_batch_size from 10 to 50. See specs/pipeline-v3.md section 7 config.
- [ ] **Workflow migration** — replace cron handler with Cloudflare Workflow for unlimited duration. See specs/pipeline-v3.md section 7. Trigger: when enrichment exceeds 10 minutes.

### Research needed
- [ ] **YAKE keyword extraction** — add as alternative to TF-IDF, benchmark both.
  - **Dependency:** `yake-js` npm package OR custom JS implementation of the YAKE algorithm
  - YAKE scores words by: position in text, frequency relative to sentence count, casing context (capitalised mid-sentence = likely entity), co-occurrence dispersion
  - Unsupervised, no corpus needed, designed for short texts (50-500 words)
  - **Benchmarking plan:**
    1. Create `scripts/benchmark-extractors.sh` that picks 100 random chunks
    2. Run TF-IDF, YAKE, and merged (reciprocal rank fusion) on each
    3. Measure: noise rate (% in NOISE_WORDS), entity recall (% of known entities found), topic overlap between methods, unique finds per method
    4. Output comparison table + 10 side-by-side examples for human review
    5. Store benchmark results in `docs/benchmark-extractors.md`
  - **Integration:** add `method` parameter to `extractTopics`: "tfidf" | "yake" | "both"
  - **Risk:** yake-js may not work in Cloudflare Workers runtime (needs testing)

## UX
- [ ] **Chunk titles** — full sentences are better than truncated, but real topic labels would be better still. Requires LLM-generated titles during ingestion.
- [ ] **Empty search state** — just a search box. Could show trending terms or popular topics.
- [ ] **First-time visitor** — no explanation of what Bobbin is or why Bits and Bobs matters. Hero text needs expanding.
- [ ] **Single-line chunk pages** — 608 chunks with just a title and no body. Consider redirecting to parent episode accordion.
- [ ] **Relative dates** — "Latest: 4/13/26" doesn't say how old it is. Show "2 days ago".

## Code quality
- [ ] **D1 generics on remaining routes** — some routes still have `as any` casts
- [ ] **data/raw/ should be gitignored** — 15MB of HTML

## Testing
- [ ] **Playwright runs on CI** — needs chromium in workflow
- [ ] **Visual tests** — agent-browser tests need AI_GATEWAY_API_KEY

## Data
- [ ] **Archive essays not fully surfaced** — 11 essay episodes exist but aren't prominent
- [ ] **Daily cron** — change from weekly (Monday 6am) to daily for fresher content
