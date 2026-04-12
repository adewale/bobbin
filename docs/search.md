# Search

Bobbin uses hybrid search: lexical full-text search (FTS5) fused with semantic vector search (Vectorize), merged via weighted reciprocal rank fusion.

## Query language

Users can mix free text with operators:

```
"cognitive labor" year:2025 after:2025-06-01
```

| Operator | Example | Effect |
|----------|---------|--------|
| `"..."` | `"resonant computing"` | Exact phrase — passed to FTS5 as a quoted MATCH |
| `before:` | `before:2025-06-01` | Filter: episodes published before this ISO date |
| `after:` | `after:2024-01-01` | Filter: episodes published after this ISO date |
| `year:` | `year:2025` | Filter: episodes from this year |

Query parsing happens in `src/lib/query-parser.ts`. Operators are extracted via regex, and the remaining free text becomes the FTS query. Multiple exact phrases are supported.

## FTS5 (lexical search)

The primary search path. Configuration:

- **Tokenizer**: `porter unicode61` — Porter stemming collapses word forms (ecosystems → ecosystem, running → run) so users don't need exact morphology
- **Columns**: `title` and `content_plain` from the `chunks` table
- **Scoring**: `bm25(chunks_fts, -5.0, -1.0)` — title matches are weighted 5x higher than content matches
- **Sync**: INSERT/UPDATE/DELETE triggers on the `chunks` table keep `chunks_fts` in sync automatically

The FTS query is sanitized by wrapping user text in double quotes, which disables FTS5 operators (AND, OR, NOT, NEAR) to prevent injection. This means all searches are phrase searches by default.

Date filters (`before:`, `after:`, `year:`) are applied as SQL WHERE clauses on the `episodes` table via a JOIN, not as FTS filters.

### Scoring normalisation

FTS5's `bm25()` returns negative values where more negative = better match. We normalise to 0–1:

```
score = (maxRank - row.rank) / (maxRank - minRank)
```

Best match = 1.0, worst match in the result set = 0.0.

## Vectorize (semantic search)

The secondary search path. Only active when the AI and Vectorize bindings are available.

- **Model**: `@cf/baai/bge-base-en-v1.5` (768-dimensional embeddings)
- **Index**: `bobbin-chunks`, cosine similarity, 768 dimensions
- **Query flow**: embed the search text → `VECTORIZE.query(vector, { topK: 15 })` → hydrate chunk metadata from D1

Vector search finds semantically related content even when the exact words don't match. Searching "how platforms consolidate" can find observations about "ecosystem dynamics" and "market concentration".

Embeddings are generated during ingestion via the `/api/embed` endpoint or during the cron enrichment phase.

## Merge and rerank

Results from both sources are merged using weighted reciprocal rank fusion:

```
Both FTS + vector:  score = ftsScore × 0.4 + vecScore × 0.6 + 0.1 (crossover bonus)
FTS only:           score = ftsScore × 0.4
Vector only:        score = vecScore × 0.6
```

The crossover bonus (+0.1) rewards results that appear in both result sets — they're relevant by two independent measures. Results are deduplicated by chunk ID and sorted by combined score descending.

This is implemented in `src/services/search.ts` → `mergeAndRerank()`.

## Fallback chain

```
FTS5 + Vectorize  →  FTS5 only  →  LIKE keyword search
```

If FTS5 is unavailable (migration not applied), falls back to `WHERE content_plain LIKE ?` with escaped metacharacters. If Vectorize is unavailable (no embeddings), skips the vector path. The page always renders results.

## Keyword search fallback

`src/db/search.ts` implements a LIKE-based fallback that respects the same date filter operators as FTS. The `%` and `_` wildcards are escaped to prevent DoS via expensive pattern matching.

## Concordance and distinctiveness

The concordance is not a search feature but informs search quality. It provides:

- **Word frequencies** across the corpus (`concordance` table)
- **Distinctiveness scores** — how unusual each word is compared to a 5,000-word English baseline. Words absent from baseline (llms, stratechery, agentic) get high scores; common words (system, trust) get low scores
- **Inline sparklines** — temporal frequency trends per word, rendered as SVG polylines inside the concordance bar chart

The concordance helps users understand what vocabulary is distinctive to Komoroske's writing, which informs what to search for.

## Tag search

Tags are searchable via the `/tags` page filter (client-side) and the `/api/tags?q=` endpoint (server-side). The tag index includes:

- **Named entities**: multi-word terms detected by capitalisation heuristics (Claude Code, Simon Willison)
- **Domain terms**: single-word terms scored by `usage_count × distinctiveness`
- **Normalisation**: plurals stripped (systems → system), entity length capped at 3 words

## Implementation files

| File | Responsibility |
|------|---------------|
| `src/lib/query-parser.ts` | Parse query string into operators + free text |
| `src/services/search.ts` | FTS5 search with date filters, merge/rerank |
| `src/db/search.ts` | LIKE keyword fallback |
| `src/routes/search.tsx` | Search page (SSR) |
| `src/routes/api.tsx` | JSON search API |
| `src/services/distinctiveness.ts` | Corpus distinctiveness scoring |
| `src/services/tag-generator.ts` | Tag extraction with TF-IDF and entity detection |
| `migrations/0002_fts5_search.sql` | FTS5 virtual table + sync triggers |
