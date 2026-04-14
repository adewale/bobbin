# Changelog

## 2026-04-14 — YAKE migration + finalization fix

The biggest pipeline overhaul since the initial build. Replaced the topic extraction
algorithm, fixed finalization (which had never successfully completed in production),
and added corpus-wide quality gates.

### Changed
- **Topic extraction**: TF-IDF replaced with YAKE (Campos et al., 2020) — pure TypeScript,
  per-document, naturally produces multi-word keyphrases. 5 keyphrases/chunk (was 10-15).
- **Finalization**: Rewritten as 18 resilient steps (was 11 atomic steps that threw on
  first error). Each step reports name, duration, status, and detail. Continues on error.
- **Quality gates**: Added df≥5 corpus-wide threshold, Porter stemming merge, Dice
  similarity clustering (threshold 0.7). Reduces raw topics to navigational set.
- **Noise filtering**: Applied to all topic sources including heuristic entities (was
  bypassing them). Added suffix heuristics (-ly, -ize, -ment) and multi-word phrase
  rules. Expanded NOISE_WORDS to 250+.
- **Batch operations**: All correlated UPDATEs batch by actual row IDs (was sparse ID
  ranges causing 435 empty queries over 434K ID space).
- **Re-enrichment**: `processChunkBatch` deletes old chunk_topics before inserting
  new ones (clean slate, no stale link accumulation).
- **Health endpoint**: Aligned "unenriched" definition with enrichment logic.

### Added
- `src/services/yake.ts` — Pure TypeScript YAKE implementation (no dependencies)
- `src/services/text-similarity.ts` — Dice coefficient, Porter stemmer, clustering
- `scripts/local-pipeline.ts` — Full ingest→enrich→finalize locally in <10s
- `scripts/analyze-topics.ts` — Corpus analysis for tuning extraction parameters
- `scripts/cleanup-db.sh` — One-time production DB cleanup
- `/api/cleanup-stale` — Delete stale chunk_topics and orphan topics
- `specs/topic-extraction-research.md` — Literature review (YAKE, RAKE, TextRank, Heap's law)
- 80+ new tests: YAKE validation, quality gates, scale tests, PBT properties

### Fixed
- Finalization always failing in production (O(n) individual DELETE queries)
- D1 CPU time limit exceeded (correlated UPDATE across 13K+ topics)
- 434K orphan topic rows accumulating across enrichment versions
- Possessive apostrophes leaking into topic names ("goodhart' law")
- HTML entities in topic names ("someone else&#39;")
- Heuristic entities bypassing noise filter ("platform" as entity)

### Metrics
| Metric | Before | After |
|--------|--------|-------|
| Active topics | 13,615 | 531 |
| Finalization | Always failed | 2.8s, all steps green |
| Top topics | "resonant", "emergent", "moment" | "Claude Code", "coasian floor", "gilded turd" |
| usage_recount | 5.0s (435 batches) | 135ms (7 batches) |
| Tests | 540 | 618 |

---

## 2026-04-12 — Pipeline v3: IDF, queue fan-out, PMI phrases

### Changed
- IDF loaded from `word_stats` table instead of per-batch computation
- Enrichment dispatched to queue for parallel processing (10 concurrent consumers)
- PMI-based phrase extraction replaces raw bigram counting
- Enrichment versioning: `enrichment_version` column for incremental re-enrichment

### Fixed
- Entity kind explosion: only curated entities get `kind='entity'`
- Single source of truth: `processChunkBatch` used by both API and queue paths
- Sentence-start capitalisation bug in heuristic entity detector

---

## 2026-04-11 — Topics system (replacing tags)

### Changed
- Renamed tags → topics, concordance → word_stats throughout
- Three-layer entity detection: curated list + heuristic capitalisation + TF-IDF
- Topic-aware search: boost, alias expansion, `topic:` operator
- Blended topic display: main tier (what episode covers) + distinctive tier (what makes it unique)

### Added
- `/topics` grid with small multiples and sparklines
- `/topics/:slug` detail with dispersion plot, KWIC, slopegraph
- Topic marginalia on episode and chunk pages
- N-gram analysis for corpus-level phrase discovery
- Known entities list (26 curated companies, people, products)

### Removed
- `/concordance` routes (replaced by `/topics`)
- Tag diff feature
- Timeline route
- Sitemap
- RSS feeds

---

## 2026-04-10 — Design and UX polish

### Changed
- Homepage: latest episode panel with margin layout, Recent Episodes + Popular Topics
- Libre Franklin wordmark + B favicon
- Accordion episodes with chevron affordance
- Consistent content width, active nav underline
- Episode prev/next navigation

### Fixed
- Homepage 500 error from unbounded topic query
- Search box width on mobile
- Dangling references from removed features
- Duplicate titles in essay episodes

### Removed
- Reading mode
- Hero h1 on top-level pages
- Breadcrumbs from top-level pages

---

## 2026-04-09 — Search quality + security

### Changed
- Hybrid search: FTS5 + Vectorize with merge/rerank and crossover boost
- Entity alias expansion for search queries
- Vector similarity threshold (0.72 cosine) to filter noise
- Quoted phrase queries skip vector search

### Fixed
- 9 route security issues (FTS injection, LIKE injection, XSS vectors)
- Entity alias expansion breaking FTS5 queries
- 26x faster most-connected query (141K rows vs 3.7M)

### Added
- Search operators: `year:`, `before:`, `after:`, `topic:`, `"..."`
- Property-based tests for search merge/rerank
- Playwright E2E tests

---

## 2026-04-08 — Initial build

### Added
- Complete SSR app on Cloudflare Workers (Hono + D1 + Vectorize + Workers AI)
- Google Docs HTML parser with margin-based chunking
- FTS5 full-text search with Porter stemming
- Semantic cross-references via BGE embeddings
- Weekly cron for automated ingestion
- 92 initial tests

### Architecture
- D1 for structured data (episodes, chunks, tags, word stats)
- Vectorize for 768-dim semantic search
- Workers AI for embedding generation
- Static assets via Cloudflare Assets
