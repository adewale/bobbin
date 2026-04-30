# Changelog

## 2026-04-30 — Correct-by-construction redesign spec, baselines, and rollback prep

### Added
- `docs/correct-by-construction-pipeline-spec.md` — forward-looking spec for a raw/staging/published snapshot pipeline, including success criteria, benchmark requirements, rollback model, and Cloudflare platform implications.
- `scripts/audit-invariant-metrics.mjs` — captures current D1 invariant metrics and drift-sensitive counts for local or remote databases.
- `scripts/compare-pipeline-baselines.mjs` — compares two characterization outputs or two invariant-audit outputs to make before/after pipeline changes measurable.
- `scripts/export-rollback-bundle.mjs` — exports a manifest plus table-level data-only SQL bundle (excluding internal and FTS shadow tables) and emits a dependency-safe `restore.sh` to support data rollback planning around major pipeline changes.

### Changed
- `package.json` now exposes `audit:invariants`, `compare:pipeline`, and `snapshot:rollback` commands.
- `README.md` and `docs/pipeline-architecture.md` now point to the forward-looking correct-by-construction spec and the new baseline/rollback tooling.

### Notes
- The new spec incorporates Cloudflare operational constraints for D1 export/import, Workers rollback/gradual deployments, Queues retry semantics, and Workflow-based orchestration.
- Rollback-bundle export intentionally does not support custom local `--persist-to` directories because `wrangler d1 export` does not support that flag.

---

## 2026-04-29 — Shipped summaries, drift hardening, and summary-surface cleanup

### Changed
- `/summaries` is now a shipped browse surface with linked year headings, chronological month ordering, and three year-level summary cards that reuse the topic small-multiples pattern: `Chunk volume`, `New topics`, and `Spikiest months`.
- `/summaries/:year` and `/summaries/:year/:month_number` are now shipped routes built from existing body/rail primitives, with deterministic `buildPeriodSummary(...)` output and closed-by-default month accordions on yearly pages.
- Summary pages no longer render an `External Links` rail panel; the rail is now intentionally limited to `New Topics`, `Movers`, and `Archive Contrast`.
- Topic- and summary-support fallback logic is now shared so persisted local D1 schema drift degrades more cleanly.

### Added
- `src/db/topic-support.ts` — shared helpers for topic-support compatibility (`episode_support` presence, support bindings/clauses, similarity-table detection).

### Fixed
- `/summaries/*`, `/topics`, and episode-detail rail paths no longer break when a persisted local D1 database lags the latest migrations.
- Summary timelines now compute per-episode chunk counts from real `chunks` rows instead of trusting drift-prone `episodes.chunk_count` metadata.
- Summary regressions now pin row-level counts, yearly timeline drift behavior, and legacy-schema fallbacks more directly.

---

## 2026-04-26 — Topic representation consolidated; period-summary foundation

### Changed
- All topic surfaces now render through a single `<TopicList>` component with three layouts (`run` / `stack` / `multiples`) and three modifiers (`trending`, `count`, `salient`). Replaces `TopicStrip`, `TopicRailList`, and `TopicCloud`.
- Topic chips removed from the design language. Topics render as inline runs (`·`-separated text) or small-multiple cells. No badges, no boxes, no chip hover states.
- Direction is encoded by typographic glyphs (`→`, `↑`, `↓`) that inherit link color. No semantic green/red.
- Episode-rail `Since Last Episode` panel now renders Up/Down/New through `<TopicList layout="run">` with the trending modifier; topic names are linkable for the first time and the `(+5)` parenthetical prose is replaced by the `↑` glyph + a tabular-num count.
- Episode-rail `Archive Contrast` and `Most Novel Chunks` migrated to `<TopicList>` so their topic mentions go through the same component as everything else.
- `EpisodeNovelChunk` data shape: `topicNames: string[]` → `topics: { name; slug }[]` so the via-meta topics are linkable.

### Added
- `<TopicList>` component (`src/components/TopicList.tsx`).
- `Period` vocabulary (`src/lib/period.ts`): `Period`, `PeriodBounds`, `periodBounds`, `previousPeriod`, `periodLabel`, `periodPath`, `parsePeriodPath`, `isWithinPeriod`. Discriminated union; `year` and `month` supported, extensible to future kinds without breaking callers.
- Period-scoped data helpers (`src/db/periods.ts`): `getEpisodesInPeriod`, `getChunksInPeriod`, `getPeriodTopicCounts`, `getPeriodNewTopics`, `getPeriodMovers`, `getPeriodArchiveContrast`, `getMostConnectedInPeriod`. All take `PeriodBounds`, kind-agnostic.
- Shared topic scoring (`src/lib/topic-scoring.ts`): `weightedTopicScore`, `weightedDeltaScore` (extracted from episode-rail logic so episode and period rankings are produced by the same function).
- `buildPeriodSummary` (`src/lib/period-summary.ts`): deterministic template-driven summary helper modelled exactly on `buildTopicSummary`. Five fixed sentence shapes; tests pin exact outputs.
- `scripts/audit-era-boundaries.ts`: corpus audit script that parses raw HTML, counts marker-term mentions per quarter, and reports first-appearance dates. Used to validate proposed era boundaries against the actual corpus.
- `docs/monthly-summaries-spec.md`: rewritten end-to-end. Covers monthly + yearly + reserved era axis. Determinism rule, quarter/season/week explicitly out of scope, per-panel emptiness rules, era axis reserved at `/eras/<slug>/`.

### Removed
- `TopicStrip`, `TopicRailList`, `TopicCloud` components.
- CSS: `.topic`, `.topics`, `.topic-cloud`, `.topic-tier*`, `.topic-search-results`, `.topic-related-inline`, `.topic-related-panel`, `.topic-related-count`, `.topics-list`, `.distinctive-list`, plus orphan descendant rules.

### Fixed
- TypeScript errors in `src/db/topics.ts` (`getAdjacentTopics` cast through `Record<string, unknown>`) and `src/routes/design.tsx` (`Most connected` chunks rendered through untyped `unknown` fields). `getMostConnected` now returns a typed `ConnectedChunk[]`.

---

## 2026-04-25 — CI maintenance and follow-through

### Changed
- `docs/lessons-learned.md` now captures the operational lessons from the D1 hardening and migration-bootstrap pass.
- GitHub Actions now uses `actions/checkout@v5`, `actions/setup-node@v5`, and `actions/upload-artifact@v5`.

### Fixed
- `src/ingestion-roundtrip.test.ts` now uses an explicit timeout budget so slower CI runners do not fail a passing end-to-end worker test at the default 5-second limit.
- Playwright report upload is now skipped cleanly when no `playwright-report/` directory exists, removing the noisy artifact warning from non-E2E failures.

## 2026-04-25 — D1 hardening, migration-chain bootstrap, and queue retry cleanup

### Changed
- Workers-test and local-pipeline database bootstrap now apply the real checked-in D1 migration chain instead of reconstructing schema by hand.
- Stale enrichment queries now use a union-based pending-chunk shape instead of an index-hostile `OR` predicate.
- Queue retries now only requeue transient D1/infrastructure failures instead of retrying every exception.

### Added
- `migrations/0020_d1_best_practice_hardening.sql` with composite indexes for audit rows, LLM evidence, episode ordering, chunk ordering, and enrichment-version lookups.
- `src/d1-best-practices.test.ts` to verify migration artifacts and index usage with `EXPLAIN QUERY PLAN`.

### Fixed
- Preview-local D1 config no longer points at the live database ID.
- Index-creating migrations now run `PRAGMA optimize` so planner stats stay fresh after schema changes.
- Local pipeline docs/comments now reference the canonical `wrangler.jsonc` path instead of stale `wrangler.local.jsonc` examples.

---

## 2026-04-24 — Shared archive surfaces, local verification, and test stabilization

### Changed
- Home, episodes, and topics now share the same editorial preamble/tagline treatment.
- Topic small-multiple sparklines now use the same rail-aligned signal treatment as the newer chart panels.
- `/design` expanded into a real component catalogue and shared-surface inventory.
- Playwright smoke/navigation/layout tests now target current local routes and fixture URLs instead of stale preview-only surfaces.
- Workers and Node Vitest suites are split more explicitly by runtime so filesystem-heavy corpus tests no longer fail under the Workers pool.

### Added
- `npm run audit:computed` for repeatable browser-level computed-style audits.
- Shared UI primitives: `HelpTip`, `TopicHeader`, `TopicChartPanel`, `TopicRailList`, `TopicStrip`, `EmptyArchiveState`.
- Canonical full-product local fixture workflow documented around `npm run fixture:local` and `npm run dev:9090`.

### Fixed
- `/topics` sparklines rendering invisibly when rail chart tokens were used outside `.rail-stack`.
- Refresh tests timing out on live network/LLM work by adding test hooks for fetch and LLM enrichment.
- Full-suite test instability from stale smoke assumptions, duplicate layout-grid scheduling, and overly parallelized runtime mixes.

---

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
