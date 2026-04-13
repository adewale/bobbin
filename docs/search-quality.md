Search Quality

## Test suite

`src/routes/search-quality.test.ts` — 15 tests covering search behavior, not just HTTP status codes.

### Exact phrase precision
- Quoted queries (`"tyler cowen"`) return only chunks containing that exact phrase
- Vector search is skipped for quoted queries (semantic matches are noise for precision queries)
- Quoted phrase returns the correct count (1 result, not 7)

### Proper noun precision
- Rare proper nouns (e.g., "oshineye") return only literal matches
- Vector results below 0.72 cosine similarity are filtered out — proper nouns not in the embedding vocabulary produce low-similarity noise

### Entity alias expansion
- Searching a canonical entity name ("simon willison") returns results
- Searching an alias ("willison") returns the same results
- Multi-word aliases are individually quoted for FTS5 (`"simon willison" OR willison`), not wrapped as a single phrase

### Vector score threshold
- Demonstrates that unfiltered low-scoring vector results dilute FTS precision (6 results instead of 1)
- Demonstrates that filtering above 0.72 preserves only relevant matches (2 results, no noise)
- Demonstrates that crossover bonus correctly rewards results found by both FTS and vector search

### Topic filter and date filter
- `topic:economics` narrows results to economics-tagged chunks
- `after:2025-02-01` excludes earlier episodes

## Bugs found and fixed

### Entity alias OR expansion broke FTS5 (2026-04-13)

**Symptom:** Searching for any known entity name ("simon willison") returned 0 results.

**Root cause:** Entity alias expansion joined terms with ` OR ` then the FTS5 query builder wrapped the entire string in phrase quotes: `'"simon willison OR willison"'`. FTS5 interpreted this as a 5-word exact phrase search.

**Fix:** Individually quote multi-word terms and pass OR through to FTS5: `"simon willison" OR willison`.

**Regression tests:** 3 tests in `src/routes/search-topics.test.ts`.

### Vector search noise for proper nouns (2026-04-13)

**Symptom:** Searching "oshineye" returned 9 results (1 correct, 8 noise). The embedding model maps unknown proper nouns to nearby semantic space, producing low-similarity matches that are completely irrelevant.

**Fix:** Filter vector results below 0.72 cosine similarity. This threshold was chosen empirically — genuine semantic matches typically score above 0.75, while noise for unknown proper nouns scores 0.3-0.5.

**Regression tests:** 3 tests demonstrating threshold value via `mergeAndRerank`.

### Vector search noise for quoted phrases (2026-04-13)

**Symptom:** Searching `"tyler cowen"` returned 7 results (1 from FTS5, 6 from vector). The vector embedding of the phrase found semantically similar chunks about other people sharing opinions.

**Fix:** Skip vector search entirely when the query contains exact phrases (`parsed.phrases.length > 0`). Quotes signal precision intent.

**Regression tests:** 2 tests in search quality suite.

## Quality principles

1. **Precision over recall for specific queries.** When a user quotes a phrase or searches a proper noun, they want exactly what they typed. Don't pad results with semantic approximations.

2. **Vector search is for exploration, FTS is for finding.** "How do platforms consolidate?" is an exploration query — vector search adds value. "tyler cowen" is a finding query — only FTS5 should answer it.

3. **Filter, don't just rank.** Low-scoring vector results shouldn't appear at all, even at the bottom. They erode trust in the search system.

4. **Test behavior, not plumbing.** Search quality tests verify "the right results appear and the wrong ones don't." They use seed data with known-good and known-bad results, not mock implementations.

## Known remaining issues

- Entity alias expansion only covers ~24 curated entities. Most people and companies mentioned in the corpus have no aliases.
- The `topic:` operator requires the exact slug — no fuzzy matching.
- Single-word searches for common words ("system", "model") return too many results with no way to narrow except `topic:` or date filters.
- Smart quote normalization handles macOS curly quotes but not all Unicode quote variants.
