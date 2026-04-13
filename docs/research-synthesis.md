# Research Synthesis: Pipeline Improvements

Compiled from three parallel research agents (2026-04-13).
Full reports: research-pipeline-patterns.md, research-nlp-quality.md, research-cf-practices.md.

## Consensus findings (all three agents agree)

1. **Load IDF from word_stats.** The doc_count column already has corpus-wide document frequency. No per-batch tokenization needed. This is the single highest-impact change.

2. **The 16-chunk batch limit is artificially low.** Workers I/O wait (D1 queries) does not count against the 30s CPU limit. Only JS execution counts. With IDF from word_stats (no tokenization), batch size can safely reach 200.

3. **Queue fan-out is the scaling path.** Dispatch per-chunk or per-batch work to the queue. 20 concurrent consumers provide 20x parallelism.

## Pipeline patterns (agent 1)

- **Enrichment versioning** prevents full rebuild when algorithm changes. Flag column + version number = selective re-processing.
- **Queue fan-out** for embarrassingly parallel per-chunk work. Each chunk's topic extraction is independent.
- **Staged pipeline** with queue-per-stage is overengineered for this scale. Single queue with message routing (current approach) is correct.

## NLP quality (agent 2)

- **YAKE** (Yet Another Keyword Extractor) is the best replacement for TF-IDF in a Workers environment. Unsupervised, no corpus needed, JS-compatible, good for short texts. Considers word position and casing context.
- **PMI** for phrases replaces raw bigram counting. Computable from chunk_words in SQL. Suppresses garbage phrases where both words are common independently.
- **Entropy-based noise detection** from chunk_words replaces the hardcoded NOISE_WORDS list. Words with uniform distribution across episodes are noise.
- **Workers AI for entity detection** costs ~$15/full re-enrichment. Only worth it for ambiguous chunks where heuristics are uncertain.
- **BERTopic clustering** requires Python (UMAP + HDBSCAN). Not viable in Workers.

## Cloudflare best practices (agent 3)

- **D1 batch size**: no hard cap, current 50 is conservative. Raise to 100.
- **Queue concurrency**: current max_concurrency=10. Platform max is 250. Raise to 20.
- **Queue batch size**: current max_batch_size=10. Platform max is 100. Raise to 50.
- **Workflows**: GA, unlimited total duration, per-step retry. Best path when cron 15-min limit is hit.
- **Analytics Engine**: non-blocking writeDataPoint() calls for pipeline metrics. Queryable via SQL API.
- **D1 Time Travel**: 30-day retention on paid plan. Note timestamps before re-enrichment for rollback.
- **Workers CPU**: I/O wait does NOT count. Only active JS execution. The per-batch CPU is overwhelmingly computeCorpusStats (tokenization), not D1 queries.

## What we decided not to do (and why)

| Idea | Why not |
|------|---------|
| BERTopic clustering | Requires Python (UMAP + HDBSCAN), not viable in Workers |
| KeyBERT | Per-word embedding API calls, too expensive at scale |
| Multiple queues per stage | Overengineered for single-queue message routing |
| Analytics Engine | console.log structured logging is sufficient at current scale |
| Full Workflow migration | Not needed until cron hits 15-min limit |
| Workers AI for all entities | $15/run, curated list + heuristics is good enough |
