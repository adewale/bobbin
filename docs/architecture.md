# Bobbin Architecture

Bobbin is a searchable archive of Alex Komoroske's "Bits and Bobs" weekly newsletter, built on Cloudflare Workers.

## System overview

```
Google Docs (mobilebasic HTML)
      │
      ▼
  [Cron: Monday 6am UTC]
      │
  fetch → parse → ingest
      │
      ├──▶ D1 (episodes, chunks, tags, concordance)
      ├──▶ Vectorize (768-dim BGE embeddings)
      └──▶ Workers AI (summaries)
      │
      ▼
  Hono SSR (22 routes)
      │
      ▼
  Browser (HTML + progressive JS)
```

## Cloudflare bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 Database | All structured data (bobbin-db) |
| `VECTORIZE` | Vector Index | Semantic search (bobbin-chunks, 768-dim, cosine) |
| `AI` | Workers AI | BGE embeddings + BART summarization |
| `ADMIN_SECRET` | Secret | Bearer token for `/api/ingest` and `/api/embed` |

## Routes

### Content
| Route | Purpose |
|-------|---------|
| `GET /` | Homepage: recent episodes, search, tag cloud |
| `GET /episodes` | Paginated episode list (20/page) |
| `GET /episodes/:slug` | Episode detail with all chunks and tags |
| `GET /chunks/:slug` | Chunk detail with cross-references as margin notes |

### Browse
| Route | Purpose |
|-------|---------|
| `GET /tags` | All tags sorted by usage |
| `GET /tags/:slug` | Ladder of abstraction: sparkline + episodes + chunks + excerpts |
| `GET /tags/:slug/diff` | Chronological evolution of a tag |
| `GET /timeline` | Years → `/timeline/:year` → months → episodes |
| `GET /timeline/:year/:month/:day` | Redirects to episode |
| `GET /concordance` | Top 200 words (≥3 occurrences, ≥2 chunks, ≥4 chars) |
| `GET /concordance/:word` | Usage over time sparkline + chunk excerpts |

### Search
| Route | Purpose |
|-------|---------|
| `GET /search?q=` | Hybrid FTS5 + Vectorize search with merge/rerank |
| `GET /api/search?q=` | JSON search results |

### Feeds
| Route | Purpose |
|-------|---------|
| `GET /feed.xml` | Atom feed (20 latest episodes) |
| `GET /tags/:slug/feed.xml` | Per-tag Atom feed (50 latest chunks) |
| `GET /sitemap.xml` | XML sitemap (all episodes, chunks, tags) |

### Admin (requires `Authorization: Bearer ADMIN_SECRET`)
| Route | Purpose |
|-------|---------|
| `GET /api/ingest?limit=N&doc=ID` | Fetch doc, parse, ingest N new episodes |
| `GET /api/embed?limit=N` | Batch-embed N chunks to Vectorize |

### Reactive API (for client-side JS)
| Route | Purpose |
|-------|---------|
| `GET /api/concordance?from=&to=&limit=` | Word frequencies with date filtering |
| `GET /api/timeline` | Episode counts per month |

## Database schema

```
sources ──1:N──▶ episodes ──1:N──▶ chunks
                     │                 │
                     ▼                 ▼
               episode_tags ◀── tags ──▶ chunk_tags
                                          │
                                          ▼
                                     chunk_words ──▶ concordance (aggregate)

chunks_fts (FTS5 virtual table, auto-synced via triggers)
ingestion_log (audit trail)
```

### Core tables
- **sources**: Google Doc IDs being tracked (`google_doc_id`, `last_fetched_at`)
- **episodes**: Weekly editions (`slug` = date like `2024-04-08`, `year/month/day`)
- **chunks**: Individual observations (`content`, `content_plain`, `vector_id`, `position`)

### Search tables
- **chunks_fts**: FTS5 virtual table over `title` + `content_plain`, Porter stemming
- **concordance**: Aggregated word frequencies (`word`, `total_count`, `doc_count`)
- **chunk_words**: Per-chunk word counts (source for concordance rebuilds)

## Ingestion pipeline

```
1. Fetch   │ fetchGoogleDocHtml(docId) → mobilebasic HTML
2. Parse   │ parseHtmlDocument(html) → ParsedEpisode[]
           │   Split on <h1> (episode dates)
           │   Split on margin-left:36pt (level-0 observations)
           │   Group sub-points (72pt, 108pt) with parent
3. Dedup   │ Skip episodes with existing published_date
4. Batch   │ Insert in groups of 50:
           │   episodes → chunks → tags → chunk_tags → episode_tags → chunk_words
5. Embed   │ generateEmbeddings(AI, texts) → VECTORIZE.upsert(vectors)
6. Summary │ generateSummary(AI, text) → episode.summary
7. Rebuild │ DELETE concordance; INSERT...SELECT from chunk_words
```

Triggered by:
- **Cron**: `0 6 * * 1` (Monday 6am UTC)
- **Manual**: `GET /api/ingest` with Bearer auth

## Search pipeline

```
User query
    │
    ├──▶ FTS5: sanitize → MATCH → bm25(title: 5x, content: 1x) → normalize to 0-1
    │
    ├──▶ Vectorize: embed query → cosine topK=15 → hydrate from D1
    │
    └──▶ Merge & Rerank (Reciprocal Rank Fusion):
           Both:     ftsScore * 0.4 + vecScore * 0.6 + 0.1 (crossover bonus)
           FTS only: ftsScore * 0.4
           Vec only: vecScore * 0.6
           Sort descending
```

Fallback chain: FTS5 → LIKE (if FTS table missing) → keyword only (if AI unavailable)

## File organization

```
src/
  index.tsx              Entry point, route registration, scheduled handler
  types.ts               Bindings, DB row types, parsed types
  components/            JSX components (Layout, EpisodeCard, ChunkCard, etc.)
  routes/                Hono sub-routers (one file per feature area)
  services/              Domain logic (search, cross-refs, HTML parsing, tags)
  jobs/                  Batch operations (ingest, refresh)
  lib/                   Pure utilities (slug, date, text, html escaping)
migrations/              D1 schema migrations
public/                  Static assets (CSS, JS, robots.txt)
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

1. **SSR over SPA**: Full HTML responses for SEO. Client JS only for progressive enhancement (live search, reactive concordance).
2. **No auth for content fetching**: Google Docs `/mobilebasic` URL works without auth for publicly shared docs.
3. **Margin-based chunking**: Each `margin-left:36pt` list item is a standalone observation. Sub-points (72pt+) group with their parent.
4. **Hybrid search**: FTS for keyword precision, vectors for semantic matching, merged with crossover boost.
5. **Batched writes**: D1 operations in groups of 50 to stay within limits.
6. **Tag extraction via TF-IDF**: Deterministic, no AI quota. Expanded stopword list filters generic words.
