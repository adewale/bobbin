# Bobbin Refactoring Audit

**Date:** 2026-04-12

## 1. Duplicated Code

### 1a. `batchExec` -- 3 identical copies (HIGH)

Identical 3-line function in three files:

- `src/jobs/ingest.ts:14-18`
- `src/jobs/queue-handler.ts:21-25`
- `src/services/word-stats.ts:3-7`

All three are `async function batchExec(db: D1Database, stmts: D1PreparedStatement[], size = 50)` with the exact same body.

**Recommendation:** Extract to `src/lib/db.ts` as a shared utility. All three callers already import from `../lib/*` so the dependency direction is natural.

### 1b. Topic ranking formula -- 4 occurrences (MEDIUM)

The SQL fragment `usage_count * CASE WHEN distinctiveness > 0 THEN distinctiveness WHEN name LIKE '% %' THEN 20 ELSE 1 END` appears in:

1. `src/db/topics.ts:46-50` -- `getTopTopics`
2. `src/db/topics.ts:187-191` -- `getThemeRiverData`
3. `src/db/topics.ts:281-285` -- `getTopTopicsWithSparklines`
4. `src/db/chunks.ts:18-22` -- `getChunkTopics`

Four occurrences of the same ranking logic. If the ranking formula changes (e.g., adjusting the multi-word bonus from 20 to something else), four places need updating.

**Recommendation:** Define a constant `TOPIC_RANK_SQL` in `src/db/topics.ts` and import it in `src/db/chunks.ts`. Alternatively, create a `topicRankOrderBy()` helper that returns the SQL fragment.

### 1c. Component word suppression -- 3 copies (MEDIUM)

The "find multi-word topics, extract component words, filter single words" pattern:

1. **`src/db/chunks.ts:27-35`** (`getChunkTopics`): Operates on `TopicRow[]` from a query, uses `t.name.includes(" ")` and `t.name.toLowerCase().split(/\s+/)`.

2. **`src/db/episodes.ts:55-62`** (`getEpisodeTopicsBlended`): Nearly identical but operates on `any[]` from a query, with cast `(t.name as string)`.

3. **`src/services/topic-quality.ts:66-89`** (`curateTopics`): Similar concept but more sophisticated -- uses phrase topics from across the corpus (not just the local context), applies a 40% threshold, and handles short words differently.

The implementations in `chunks.ts` and `episodes.ts` are structurally identical -- only the type annotations differ. The `topic-quality.ts` version is different enough to justify being separate.

**Recommendation:** Extract the local suppression logic (chunks.ts/episodes.ts pattern) into a shared function like `suppressComponentWords(topics: {name: string}[]): filtered[]` in `src/services/topic-quality.ts` alongside the existing `curateTopics`.

### 1d. ThemeRiver rendering -- no remaining duplication (OK)

`ThemeRiver` is cleanly extracted to `src/components/ThemeRiver.tsx`. `getThemeRiverData` lives in `src/db/topics.ts`. The component is exported but currently not imported anywhere in non-test code. This is likely dead code from when it was removed from the homepage and topics index (see test at `src/routes/topic-advanced-viz.test.ts:103,111`).

### 1e. `isNoiseTopic` import pattern -- consistent (OK)

All four production consumers import identically from `../services/topic-quality`:

- `src/jobs/ingest.ts:7` -- `import { isNoiseTopic } from "../services/topic-quality"`
- `src/db/topics.ts:2` -- `import { curateTopics, isNoiseTopic } from "../services/topic-quality"`
- `src/db/episodes.ts:2` -- `import { isNoiseTopic } from "../services/topic-quality"`
- `src/db/chunks.ts:2` -- `import { isNoiseTopic } from "../services/topic-quality"`

No inconsistency here.

---

## 2. Missing Abstractions

### 2a. Enrichment pipeline has no Step interface (LOW)

`finalizeEnrichment` in `src/jobs/ingest.ts:175-360` is a ~185-line function with 10+ sequential steps: recalculate usage, rebuild word_stats, precompute reach, merge co-occurring topics, extract n-grams, deduplicate phrases, precompute distinctiveness, precompute related_slugs, validate entities, remove noise, prune. Each step is inline SQL with error handling.

However, these steps have heterogeneous signatures (some need `queue`, some need `db` only, some produce counts). A Step interface would add ceremony without much benefit since the steps don't need to be reordered or plugged in dynamically. The function is long but each step is straightforward.

**Recommendation:** Rather than a formal Step interface, consider extracting the largest steps into named functions (like `mergeCoOccurringTopics` already is). The "self-healing cleanup" block (lines 315-357) and the "related_slugs computation" block (lines 262-313) are good candidates. This would shrink `finalizeEnrichment` to ~50 lines of orchestration.

### 2b. Topic display pipeline -- hidden shared pattern (MEDIUM)

Four functions follow the same pattern: query topics -> filter noise -> optionally curate -> optionally suppress components:

| Function | Location | Noise filter | Curate | Suppress |
|---|---|---|---|---|
| `getTopTopics` | `db/topics.ts:39` | via `curateTopics` | Yes | via `curateTopics` |
| `getTopTopicsWithSparklines` | `db/topics.ts:271` | via `curateTopics` | Yes | via `curateTopics` |
| `getEpisodeTopicsBlended` | `db/episodes.ts:31` | `isNoiseTopic` | No | Manual inline |
| `getChunkTopics` | `db/chunks.ts:13` | `isNoiseTopic` | No | Manual inline |

The first two delegate to `curateTopics` (corpus-level). The last two do it inline (local-level). These are genuinely different strategies, not a missed abstraction. The inline suppression in chunks/episodes is context-specific (suppress within *this* chunk's topics, not corpus-wide).

**Recommendation:** Extract the local suppress logic (see 1c) but don't force a unified pipeline. The corpus-level and local-level approaches serve different purposes.

### 2c. Known-entities list is static (LOW)

`src/data/known-entities.ts` is a 40-entry static array of people, companies, and products. It's imported by:
- `src/services/topic-extractor.ts` (entity detection)
- `src/routes/api.tsx` (entity alias expansion for search)

Making this "pluggable" (curated + heuristic + AI) adds complexity for a small corpus. The heuristic layer already exists in `extractEntities` (capitalized word detection). The static list handles known entities. Adding AI detection would require API calls during ingestion.

**Recommendation:** No change needed now. If the entity list grows past ~100 entries, consider moving it to a database table so it can be edited without redeployment.

### 2d. Hardcoded constants (LOW)

| Constant | Location | Value | Notes |
|---|---|---|---|
| `PAGE_SIZE` | `src/routes/topics.tsx:12` | 20 | Only used in one file |
| Noise word list | `src/services/topic-quality.ts:2-42` | ~140 words | Static set |
| `batchExec` size | 3 locations | 50 | D1 batch limit |
| Queue batch size | `src/jobs/queue-handler.ts:94`, `ingest.ts:286` | 25 | Queue API limit |
| `enrichAllChunks` defaults | `src/jobs/ingest.ts:366` | batchSize=100, maxMs=25000 | Overridden by callers |

These are all sensible defaults. None would benefit from being environment variables since they're either D1/Queue API constraints or UI choices that rarely change.

**Recommendation:** No change needed. The batch sizes are API constraints, and PAGE_SIZE is a single-use constant.

---

## 3. Refactoring Opportunities

### 3a. `src/jobs/ingest.ts` is 527 lines (HIGH)

The file contains 7 exported functions plus 2 private helpers. The biggest problem is `finalizeEnrichment` at ~185 lines.

**Recommendation:** Split into 3 files:
- `src/jobs/ingest.ts` -- Keep `ingestEpisodesOnly` and `ingestParsedEpisodes` (the "write" path)
- `src/jobs/enrichment.ts` -- Move `enrichChunks`, `enrichAllChunks`, `isEnrichmentComplete`
- `src/jobs/finalization.ts` -- Move `finalizeEnrichment`, `mergeCoOccurringTopics`, `extractAndStoreNgrams`

This follows the existing test naming convention (there are already `enrichment.test.ts` and `finalization.test.ts` files).

### 3b. crawler/ barrel re-exports -- 3 indirection files (MEDIUM)

```
src/crawler/index.ts  -- re-exports from ./fetch, ./parse, ./ingest
src/crawler/ingest.ts -- re-exports from ../jobs/ingest
src/crawler/parse.ts  -- re-exports from ../services/html-parser
src/crawler/fetch.ts  -- actual code (30 lines)
```

Only `fetch.ts` has real code. The other three are pure re-export wrappers. Consumers (`src/routes/api.tsx`, `src/jobs/refresh.ts`) import from `../crawler` which goes through `index.ts` -> `ingest.ts` -> `../jobs/ingest.ts`.

**Recommendation:** Eliminate the barrel. Have consumers import directly:
- `import { fetchGoogleDoc } from "../crawler/fetch"`
- `import { parseHtmlDocument } from "../services/html-parser"`
- `import { ingestEpisodesOnly, ... } from "../jobs/ingest"`

Delete `src/crawler/index.ts`, `src/crawler/ingest.ts`, `src/crawler/parse.ts`.

### 3c. `src/routes/topics.tsx` -- 345 lines with inline SVGs (MEDIUM)

The `/:slug` route handler (lines 53-343) contains inline SVG generation for:
- **Dispersion plot** (lines 110-136): ~27 lines of SVG
- **Sparkline with mean line** (lines 139-195): ~57 lines of SVG
- **Slopegraph** (lines 199-257): ~59 lines of SVG + data transformation
- **KWIC table** (lines 260-279): ~20 lines

Each of these is a self-contained visualization.

**Recommendation:** Extract the top 2 by size:
- `src/components/Slopegraph.tsx` -- the rank-over-time visualization (59 lines, most complex)
- `src/components/TopicSparkline.tsx` -- sparkline with mean reference line (57 lines)

This would bring the route handler under 230 lines.

### 3d. Test helper schema sync (MEDIUM)

`test/helpers/migrations.ts` has a 108-line schema that must match 7 migration files in `migrations/`. If a migration adds a column, the test helper must be updated manually.

**Recommendation:** Replace the static schema with a function that applies the actual migration files in order. Read the `migrations/` directory, sort by filename, and execute each `.sql` file. This eliminates the sync problem entirely. The test setup would be:
```ts
async function applyTestMigrations(db: D1Database) {
  for (const file of migrationFiles) {
    const sql = readFile(file);
    for (const stmt of sql.split(';')) {
      if (stmt.trim()) await db.prepare(stmt).run();
    }
  }
}
```

Note: This depends on whether the Miniflare test environment supports reading files. If not, the current approach is the pragmatic choice, but adding a comment noting which migration each table corresponds to would help.

### 3e. CSS: 446 lines in one file (LOW)

`public/styles/main.css` is organized with section comments (`/* === Section === */`) covering: Reset, Layout, Typography, Hero, Search, Cards, Episode Detail, Chunk Detail, Topics, Breadcrumbs, Pagination, Timeline, Word Stats, Small Multiples, Sparkline, Dispersion, KWIC, ThemeRiver, Slopegraph, Homepage.

The file is well-organized with clear section markers. At 446 lines, it's manageable for a server-rendered app with no build step. Splitting would require either a CSS bundler or multiple `<link>` tags (adding HTTP requests).

**Recommendation:** No split needed. The section comments provide adequate navigation. If it grows past ~600 lines, consider splitting by page (word-stats styles are ~80 lines, topic detail styles are ~60 lines).

---

## 4. Dead Code

### 4a. `extractAndStoreNgrams` -- still used, but only as fallback (OK)

`src/jobs/ingest.ts:437-480` is called from `finalizeEnrichment` (line 224) only when no queue is available (the `else` branch of `if (queue)`). This is the inline fallback for tests and dev environments. Not dead -- it's the non-queue code path.

### 4b. `/word-stats` route -- NOT linked from navigation (MEDIUM)

The word-stats page is registered at `src/index.tsx:38` but **not linked from the main navigation**. The `Layout.tsx` nav only includes Episodes and Topics (line 10-13). There is no link to `/word-stats` from the homepage or any other page.

The route is accessible directly via URL and has an API endpoint at `/api/word-stats`. The `getMostConnected` function from `db/word-stats.ts` is used on the homepage, but the actual `/word-stats` page itself is unlisted.

**Recommendation:** Either add `/word-stats` to the nav in `Layout.tsx`, or remove the route entirely and keep only the API endpoint. If the page is intentionally hidden (power-user feature), document that decision.

### 4c. Unused exported functions

Functions exported but never imported in production code (only in tests):

| Function | File | Notes |
|---|---|---|
| `getFilteredTopics` | `src/db/topics.ts:61` | No importers |
| `getTopicFeedChunks` | `src/db/topics.ts:118` | No importers |
| `getThemeRiverData` | `src/db/topics.ts:178` | No importers (ThemeRiver component also unused) |
| `updateWordStats` | `src/services/word-stats.ts:19` | Only in tests |
| `rebuildWordStatsAggregates` | `src/services/word-stats.ts:43` | Only in tests |
| `normalizeTerm` | `src/services/topic-extractor.ts:18` | Only in tests |
| `computeDistinctiveness` | `src/services/distinctiveness.ts:51` | Only imported by its own module |
| `loadEnglishBaseline` | `src/services/distinctiveness.ts:25` | Only imported by its own module |
| `detectSIPs` | `src/services/distinctiveness.ts:100` | Only imported by its own module |
| `getExcerptAroundWord` | `src/lib/highlight.ts:41` | No importers |
| `stripToPlainText` | `src/lib/text.ts:122` | No importers (not even tests) |
| `ThemeRiver` component | `src/components/ThemeRiver.tsx` | Not imported anywhere |

`updateWordStats` and `rebuildWordStatsAggregates` were the original word-stats pipeline before `enrichChunks` inlined equivalent logic. They're now redundant with the enrichment path -- kept only for test convenience.

**Recommendation:**
- **Delete:** `stripToPlainText`, `getExcerptAroundWord`, `getFilteredTopics`, `getTopicFeedChunks` -- truly dead.
- **Delete or keep for tests:** `updateWordStats`, `rebuildWordStatsAggregates`, `normalizeTerm` -- used only in tests; decide if those tests add value.
- **Decide:** `ThemeRiver` + `getThemeRiverData` -- was this intentionally removed from the UI? If so, delete. If planned for future use, keep.

---

## Priority Summary

| Priority | Item | Impact |
|---|---|---|
| **HIGH** | 1a. Extract `batchExec` to shared utility | Eliminates 3-way duplication of a core pattern |
| **HIGH** | 3a. Split `ingest.ts` into ingest/enrichment/finalization | 527-line file becomes 3 focused files matching existing test structure |
| **MEDIUM** | 3b. Remove crawler barrel re-exports | Eliminates 3 files of pure indirection |
| **MEDIUM** | 1b. Extract topic ranking SQL constant | 4 copies of the same formula |
| **MEDIUM** | 1c. Extract component word suppression helper | 2 near-identical inline implementations |
| **MEDIUM** | 3c. Extract Slopegraph and TopicSparkline components | Simplifies the largest route handler |
| **MEDIUM** | 4b. Decide on word-stats page visibility | Unlisted page should be linked or removed |
| **MEDIUM** | 4c. Remove dead exports | 5-6 functions that nobody calls |
| **LOW** | 3d. Auto-apply migrations in tests | Would eliminate schema sync problem |
| **LOW** | 2a. Extract finalization sub-steps | Would improve readability but is not blocking |
