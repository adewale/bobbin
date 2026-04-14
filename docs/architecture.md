# Bobbin Architecture

Bobbin is a searchable archive of Alex Komoroske's "Bits and Bobs" weekly newsletter, built on Cloudflare Workers.

## System overview

```
Google Docs (mobilebasic HTML)
      │
      ▼
  [Cron: Monday 6am UTC]
      │
  fetch → parse → ingest → enrich → finalize
      │                        │          │
      ├──▶ D1 (episodes, chunks, topics, word_stats)
      ├──▶ Vectorize (768-dim BGE embeddings)
      └──▶ ENRICHMENT_QUEUE (n-gram + related_slugs)
      │
      ▼
  Hono SSR
      │
      ▼
  Browser (HTML + progressive JS)
```

## Cloudflare bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 Database | All structured data (bobbin-db) |
| `VECTORIZE` | Vector Index | Semantic search (bobbin-chunks, 768-dim, cosine) |
| `AI` | Workers AI | BGE embeddings |
| `ADMIN_SECRET` | Secret | Bearer token for admin API endpoints |
| `ENRICHMENT_QUEUE` | Queue | Async n-gram assignment + related_slugs computation |

## Routes

### Content
| Route | Purpose |
|-------|---------|
| `GET /` | Homepage: latest episode panel, margin layout with Recent Episodes + Popular Topics |
| `GET /episodes` | Paginated episode list (20/page) |
| `GET /episodes/:slug` | Episode detail with all chunks and topics |
| `GET /chunks/:slug` | Chunk detail with cross-references as margin notes |

### Browse
| Route | Purpose |
|-------|---------|
| `GET /topics` | Topic grid: small multiples with sparklines, sorted by quality |
| `GET /topics/:slug` | Topic detail: sparkline, dispersion plot, KWIC, slopegraph, episode timeline |

### Search
| Route | Purpose |
|-------|---------|
| `GET /search?q=` | Hybrid FTS5 + Vectorize search with merge/rerank |
| `GET /api/search?q=` | JSON search results |

### Admin (requires `Authorization: Bearer ADMIN_SECRET`)
| Route | Purpose |
|-------|---------|
| `GET /api/ingest?limit=N&doc=ID` | Fetch doc, parse, ingest N new episodes |
| `GET /api/embed?limit=N` | Batch-embed N chunks to Vectorize |
| `GET /api/enrich?batch=N` | Enrich unenriched chunks (topics, word stats) |
| `GET /api/enrich-parallel?batch=N` | Dispatch enrichment batches to queue |
| `GET /api/finalize` | Run finalization (18 steps, quality gates, cleanup) |
| `GET /api/cleanup-stale` | One-time: delete stale chunk_topics + orphan topics |
| `GET /api/health` | Pipeline health check (chunk/topic counts, unenriched) |
| `GET /api/ingestion-log` | View recent ingestion history |

### Reactive API (for client-side JS)
| Route | Purpose |
|-------|---------|
| `GET /api/word-stats?from=&to=&limit=` | Word frequencies with date filtering |
| `GET /api/topics?q=` | Topic name search (autocomplete) |

## Database schema

```
sources ──1:N──▶ episodes ──1:N──▶ chunks
                     │                 │
                     ▼                 ▼
             episode_topics ◀── topics ──▶ chunk_topics
                                          │
                                          ▼
                                     chunk_words ──▶ word_stats (aggregate)

chunks_fts (FTS5 virtual table, auto-synced via triggers)
ingestion_log (audit trail)
```

### Core tables
- **sources**: Google Doc IDs being tracked (`google_doc_id`, `last_fetched_at`)
- **episodes**: Weekly editions (`slug` = date like `2024-04-08`, `year/month/day`, `format`)
- **chunks**: Individual chunks (`content`, `content_plain`, `vector_id`, `position`, `reach`)

### Topic tables
- **topics**: Extracted topics (`name`, `slug`, `usage_count`, `kind`, `distinctiveness`, `related_slugs`)
- **chunk_topics**: Many-to-many link between chunks and topics
- **episode_topics**: Many-to-many link between episodes and topics

### Search tables
- **chunks_fts**: FTS5 virtual table over `title` + `content_plain`, Porter stemming
- **word_stats**: Aggregated word frequencies (`word`, `total_count`, `doc_count`, `distinctiveness`, `in_baseline`)
- **chunk_words**: Per-chunk word counts (source for word_stats rebuilds)

## Ingestion pipeline

```
1. Fetch   │ fetchGoogleDoc(docId) → mobilebasic HTML
2. Parse   │ parseHtmlDocument(html) → ParsedEpisode[]
           │   Split on <h1> (episode dates)
           │   Split on margin-left:36pt (level-0 chunks)
           │   Group sub-points (72pt, 108pt) with parent
3. Dedup   │ Skip episodes with existing published_date
4. Ingest  │ Insert in groups of 50:
           │   episodes → chunks
5. Enrich  │ Per unenriched chunk batch (processChunkBatch):
           │   DELETE old chunk_topics (clean slate on re-enrichment)
           │   → extractTopics: known entities + heuristic entities + YAKE (5 keyphrases)
           │   → noise filter at insert time → INSERT topics, chunk_topics
           │   → tokenize → INSERT chunk_words
6. Final   │ 18 steps, ~3s total (resilient — continues on error):
           │   fix names, purge orphans, recount usage, rebuild word_stats,
           │   precompute reach + distinctiveness, n-grams (via queue),
           │   related_slugs, entity validation, noise cleanup,
           │   df≥5 quality gate, stem merge, similarity clustering,
           │   delete orphans, phrase dedup
7. Embed   │ generateEmbeddings(AI, texts) → VECTORIZE.upsert(vectors)
```

Triggered by:
- **Cron**: `0 6 * * 1` (Monday 6am UTC) — runs the full pipeline via `runRefresh`
- **Manual**: Admin API endpoints with Bearer auth

## Search pipeline

```
User query
    │
    ├──▶ Parse: extract operators (year:, before:, after:, topic:, "...")
    │
    ├──▶ Entity alias expansion (known-entities.ts)
    │
    ├──▶ FTS5: sanitize → MATCH → bm25(title: 5x, content: 1x) → normalize to 0-1
    │
    ├──▶ Vectorize: embed query → cosine topK=15 → filter < 0.72 → hydrate from D1
    │         (skipped for quoted phrase queries)
    │
    ├──▶ Topic boost: +0.15 for chunks assigned to matching topics
    │
    └──▶ Merge & Rerank:
           Both:     ftsScore * 0.4 + vecScore * 0.6 + 0.1 (crossover bonus)
           FTS only: ftsScore * 0.4
           Vec only: vecScore * 0.6
           Sort descending
```

Fallback chain: FTS5 + Vectorize → FTS5 only → LIKE keyword search

## File organization

```
src/
  index.tsx              Entry point, route registration, scheduled + queue handlers
  types.ts               Bindings, DB row types, parsed types
  components/            JSX components (Layout, EpisodeCard, ChunkCard, TopicCloud, etc.)
  routes/                Hono sub-routers (home, episodes, chunks, topics, search, api)
  services/              Domain logic (search, YAKE extraction, entity detection, text similarity, n-grams)
  jobs/                  Pipeline operations (ingest, refresh, queue-handler)
  db/                    Database query functions (episodes, chunks, topics, word-stats, search)
  data/                  Static data (known-entities.ts)
  lib/                   Pure utilities (slug, date, text, html, query-parser, entity-aliases)
  crawler/               Google Docs fetcher
migrations/              D1 schema migrations (0001-0009)
scripts/                 Operational tooling:
                           run-refresh.sh (mirrors cron), run-enrichment.sh (enrich only),
                           local-pipeline.ts (full local E2E), analyze-topics.ts (corpus analysis),
                           cleanup-db.sh (one-time DB cleanup)
public/                  Static assets (CSS, favicon.svg, robots.txt)
test/                    Fixtures and helpers
docs/                    Architecture and lessons learned
```

## Security measures

- **Auth**: Admin endpoints require `Authorization: Bearer ADMIN_SECRET`
- **FTS injection**: User queries wrapped in double quotes (disables FTS operators)
- **LIKE injection**: `%` and `_` metacharacters escaped with `ESCAPE '\\'`
- **XSS**: Hono JSX auto-escapes; `dangerouslySetInnerHTML` uses `safeJsonForHtml`
- **XML**: All output through `escapeXml` (includes `&apos;`)
- **Errors**: Generic messages to clients; details logged server-side
- **SQL**: All queries use parameterized `prepare().bind()`

## Key design decisions

1. **SSR over SPA**: Full HTML responses for SEO. Client JS only for progressive enhancement.
2. **No auth for content fetching**: Google Docs `/mobilebasic` URL works without auth for publicly shared docs.
3. **Margin-based chunking**: Each `margin-left:36pt` list item is a standalone chunk. Sub-points (72pt+) group with their parent.
4. **Hybrid search**: FTS for keyword precision, vectors for semantic matching, merged with crossover boost. Topic boost rewards thematic relevance.
5. **Batched writes**: D1 operations in groups of 50 to stay within limits.
6. **YAKE keyword extraction**: Replaced TF-IDF with YAKE (Campos et al., 2020) — pure TypeScript, per-document, produces multi-word keyphrases naturally. 5 keyphrases/chunk. Known entities detected separately via curated list.
7. **Corpus-wide quality gates**: df≥5 threshold (Yang & Pedersen, 1997) + Porter stemming merge + Dice similarity clustering. Reduces 27K raw topics to ~530 navigational topics.
8. **Resilient finalization**: 18 steps, each wrapped in `runStep()` with timing/error reporting. Continues on error, returns partial results. Batches by actual row IDs, not sparse ID ranges.
9. **Queue-based parallelization**: Slow enrichment steps (n-gram assignment, related_slugs) dispatched to ENRICHMENT_QUEUE for parallel processing.
10. **Wide event logging**: Canonical log lines for cron (`refresh` event) and queue (`queue_batch` event) with per-step timing.
11. **Local development pipeline**: `scripts/local-pipeline.ts` runs full ingest→enrich→finalize against real data in <10s via `getPlatformProxy()`.
