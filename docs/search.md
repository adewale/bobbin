# Search

Bobbin uses hybrid search: lexical full-text search (FTS5) fused with semantic vector search (Vectorize), merged via weighted reciprocal rank fusion. Search is topic-aware — it boosts results assigned to matching topics and expands entity aliases automatically.

## Query language

Users can mix free text with operators:

```
"cognitive labor" year:2025 topic:ecosystem
```

| Operator | Example | Effect |
|----------|---------|--------|
| `"..."` | `"resonant computing"` | Exact phrase — passed to FTS5 as a quoted MATCH |
| `before:` | `before:2025-06-01` | Filter: episodes published on or before this date |
| `after:` | `after:2024-01-01` | Filter: episodes published on or after this date |
| `year:` | `year:2025` | Filter: episodes from this year |
| `topic:` | `topic:ecosystem` | Facet filter: only chunks assigned to this topic |

Query parsing happens in `src/lib/query-parser.ts`. Operators are extracted via regex, and the remaining free text becomes the FTS query. Multiple exact phrases and topic filters are supported. Smart/curly quotes (U+201C, U+201D) are normalized to straight quotes.

## FTS5 (lexical search)

The primary search path. Configuration:

- **Tokenizer**: `porter unicode61` — Porter stemming collapses word forms
- **Columns**: `title` and `content_plain` from the `chunks` table
- **Scoring**: `bm25(chunks_fts, -5.0, -1.0)` — title matches weighted 5x
- **Sync**: INSERT/UPDATE/DELETE triggers keep `chunks_fts` in sync

Date filters are applied as SQL WHERE clauses on `episodes` via a JOIN. Topic filters add `AND c.id IN (SELECT chunk_id FROM chunk_topics WHERE topic_id = ?)`.

### Scoring normalisation

FTS5's `bm25()` returns negative values (more negative = better). Normalised to 0-1:

```
score = (maxRank - row.rank) / (maxRank - minRank)
```

## Vectorize (semantic search)

Secondary path. Only active when AI and Vectorize bindings exist.

- **Model**: `@cf/baai/bge-base-en-v1.5` (768-dim embeddings)
- **Index**: `bobbin-chunks`, cosine similarity
- **Query flow**: embed search text → `VECTORIZE.query(vector, { topK: 15 })` → hydrate from D1

## Merge and rerank

```
Both FTS + vector:  score = ftsScore × 0.4 + vecScore × 0.6 + 0.1 (crossover bonus)
FTS only:           score = ftsScore × 0.4
Vector only:        score = vecScore × 0.6
```

## Topic-aware features

### Topic boost

When the query text matches a topic slug or name, chunks assigned to that topic get +0.15. This rewards chunks where the concept is thematically central, not just mentioned in passing. Implemented in `src/services/search-topics.ts`.

### Entity alias expansion

When a query matches a known entity (from `src/data/known-entities.ts`), all aliases are added as FTS5 OR terms. Searching "Stratechery" also matches "Ben Thompson" chunks.

Multi-word aliases are individually quoted for FTS5: `"simon willison" OR willison`. The OR is passed through to FTS5 as-is, not wrapped in phrase quotes.

### Topic filter

`topic:slug` resolves the slug to a topic ID and adds a WHERE clause filtering to chunks in `chunk_topics`. Multiple topic filters intersect (chunks must have ALL specified topics).

## Fallback chain

```
FTS5 + Vectorize  →  FTS5 only  →  LIKE keyword search
```

The LIKE fallback strips FTS5 operators and quotes before matching, falling back to the primary search term.

## Bug history

- **Entity alias OR expansion broke FTS5** (2026-04-13): Joining aliases with ` OR ` then wrapping in phrase quotes made FTS5 search for the literal 5-word phrase "simon willison OR willison". Fix: individually quote multi-word terms, pass OR to FTS5 as-is. Regression tests in `src/routes/search-topics.test.ts`.

## Implementation files

| File | Responsibility |
|------|---------------|
| `src/lib/query-parser.ts` | Parse query string into operators + free text |
| `src/services/search.ts` | FTS5 search, merge/rerank |
| `src/services/search-topics.ts` | Topic boost + topic filter |
| `src/lib/entity-aliases.ts` | Entity alias expansion |
| `src/data/known-entities.ts` | Curated entity list with aliases |
| `src/db/search.ts` | LIKE keyword fallback |
| `src/routes/search.tsx` | Search page (SSR) |
| `src/routes/api.tsx` | JSON search API |
| `migrations/0002_fts5_search.sql` | FTS5 virtual table + sync triggers |
