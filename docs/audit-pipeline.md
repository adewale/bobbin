# Bobbin Data Normalization Pipeline Audit

**Date:** 2026-04-12

## 1. Order of Operations

### Current Sequence

**`enrichChunks` (per-batch, called repeatedly):**
1. Fetch unenriched chunks (`src/db/ingestion.ts:24-31`)
2. For each chunk: `extractTopics(chunk.content_plain)` (`src/services/topic-extractor.ts:228-314`)
   - Calls `decodeHtmlEntities(text)` (line 233)
   - Calls `extractKnownEntities(text)` on *raw* text (line 236) -- **BUG: uses undecoded text**
   - Calls `extractEntities(text)` on *raw* text (line 239) -- **BUG: same issue**
   - Calls `tokenize(clean)` on decoded text (line 245)
   - Calls `extractBigrams(clean)` (line 255)
   - TF-IDF scoring + merge of all three layers
3. Collect unique topics into a Map, batch INSERT OR IGNORE into `topics` table (lines 101-105)
4. Batch INSERT OR IGNORE into `chunk_topics` (lines 108-115)
5. Batch INSERT OR IGNORE into `episode_topics` (lines 118-128)
6. For each chunk: `tokenizeForWordStats(chunk.content_plain)` (line 133)
   - Calls `tokenize(text)` -- **no `decodeHtmlEntities` call** (`src/services/word-stats.ts:10`)
7. Batch INSERT OR REPLACE into `chunk_words` (lines 136-141)

**`finalizeEnrichment` (once after all chunks enriched):**
1. Recalculate `topics.usage_count` (line 152-154)
2. Rebuild `word_stats` from `chunk_words` (lines 157-168)
3. Precompute `chunks.reach` (lines 171-177)
4. `mergeCoOccurringTopics` -- hardcoded phrase rules (lines 218-263)
5. `extractAndStoreNgrams` -- corpus-level bigram/trigram discovery (lines 271-313)
6. Precompute `topics.distinctiveness` from `word_stats` (lines 186-190)
7. Precompute `topics.related_slugs` (lines 193-212)

### Ordering Problems

**Problem A: N-grams run AFTER per-chunk topic extraction.**
Corpus-level n-grams (`extractAndStoreNgrams`, line 183) discover phrases like "prompt injection" across the whole corpus. But per-chunk topic extraction (step 2 above) already ran for every chunk without knowing these phrases exist. The per-chunk `extractBigrams` (line 316-334 in topic-extractor.ts) can only discover bigrams that repeat >= 2 times *within a single chunk*. A phrase that appears once per chunk but across 50 chunks will be found by corpus n-grams but missed by per-chunk extraction.

**Recommendation:** Run corpus n-gram extraction BEFORE per-chunk topic extraction. Feed discovered phrases into `extractTopics` as a "known phrases" list alongside `KNOWN_ENTITIES`. This eliminates the need for the hardcoded `mergeCoOccurringTopics` rules entirely.

**Problem B: Distinctiveness computed AFTER topic extraction.**
`topics.distinctiveness` is computed at `finalizeEnrichment` line 186-190, by joining against `word_stats.distinctiveness`. But `extractTopics` never uses distinctiveness to decide *which* topics to extract -- it only uses TF-IDF. This means the extraction step cannot prefer distinctive terms over generic ones.

**Recommendation:** This ordering is actually defensible for the current design. Distinctiveness is used at *display* time (ORDER BY clauses in `db/topics.ts`) rather than at extraction time. However, if you want to use distinctiveness to *filter* during extraction, word_stats would need to be pre-populated before enrichment begins.

**Problem C: word_stats rebuilt AFTER topic extraction, but topic extraction doesn't use word_stats.**
Currently, `enrichChunks` inserts `chunk_words` (step 6-7), and `finalizeEnrichment` rebuilds `word_stats` (step 2). The `extractTopics` function accepts an optional `corpusStats` parameter but `enrichChunks` **never passes it** (line 94: `extractTopics(chunk.content_plain)` -- no corpusStats argument). This means all TF-IDF scoring falls back to pure TF (no IDF), making the "IDF" in TF-IDF dead code during actual ingestion.

**Recommendation:** Either:
- (a) Pre-build corpus stats before enrichment and pass them in, or
- (b) Run enrichment in two passes: first pass builds `chunk_words` and `word_stats`, second pass extracts topics using corpus stats.

This is the most impactful ordering bug: **IDF is never actually used during ingestion**.

---

## 2. Duplicated Work

### 2a. Redundant Known Entity INSERTs

`enrichChunks` collects topics into a `uniqueTopics` Map (line 91), deduplicating within a batch. Across batches, the `INSERT OR IGNORE` (line 103) silently discards duplicates. For a corpus of ~5000 chunks with 36 known entities, the worst case is 36 * (5000/batchSize) = 3,600 redundant INSERT attempts (at batchSize=50). Each is a no-op at the DB level, but it's still 3,600 prepared statements compiled, bound, and executed.

**Impact:** Low-to-moderate. D1's `INSERT OR IGNORE` is cheap. The Map deduplication within a batch (line 91) already handles intra-batch duplicates. Cross-batch duplicates are unavoidable without a persistent cache.

**Recommendation:** Pre-seed known entities into the `topics` table at migration time. Then `enrichChunks` only needs to INSERT topics discovered by TF-IDF/heuristics, which are more likely to be novel.

### 2b. Double Tokenization

`extractTopics` tokenizes via:
- `tokenize(clean)` at `topic-extractor.ts:245` (for TF-IDF)
- `extractBigrams(clean)` at `topic-extractor.ts:316-334` (re-tokenizes with a different regex)

`tokenizeForWordStats` tokenizes via:
- `tokenize(text)` at `word-stats.ts:10`

These use different inputs:
- `extractTopics` calls `decodeHtmlEntities(text)` first, then tokenizes the *decoded* text
- `tokenizeForWordStats` tokenizes the *raw* text (no HTML entity decoding)
- `extractBigrams` uses its own regex: `.replace(/[^a-z0-9\s'-]/g, " ")` with a minimum word length of 3

**Three separate tokenization passes** happen for every chunk, with inconsistent preprocessing.

**Recommendation:** Create a single `prepareChunkText(contentPlain)` function that decodes HTML entities once, then tokenize once. Pass the token list to both topic extraction and word stats. This saves ~2 tokenization passes per chunk and ensures consistency.

### 2c. Per-Chunk Bigrams vs Corpus N-grams

`extractBigrams` (`topic-extractor.ts:316-334`): Per-chunk, requires count >= 2 within a single chunk, no stopword filtering, minimum word length 3.

`extractCorpusNgrams` (`ngram-extractor.ts:7-55`): Corpus-wide, requires count >= 5 across corpus AND doc_count >= 3, filters stopwords at phrase boundaries, minimum word length 3.

**Overlap:** Both extract bigrams from the same text. The per-chunk version finds high-frequency *within-chunk* bigrams (e.g., a repeated phrase in a single chunk). The corpus version finds *cross-chunk* bigrams. They have different quality thresholds.

**Recommendation:** Remove per-chunk `extractBigrams` from `extractTopics`. It has no stopword filtering (unlike corpus n-grams) and requires count >= 2 within a single chunk, which is a weak signal. Corpus n-grams are strictly better for discovering meaningful phrases. After removing it, any phrase that appeared twice in one chunk but nowhere else would be lost -- but that's not a meaningful topic anyway.

---

## 3. Text Normalization Chain

### Content Path: Google Docs HTML to Topic

1. **HTML parsing** (`html-parser.ts:7-13`): `stripHtml` calls `decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))` -- strips tags, decodes entities, collapses whitespace. The result becomes `chunk.contentPlain`.

2. **Topic extraction** (`topic-extractor.ts:233`): `extractTopics` calls `decodeHtmlEntities(text)` again on `contentPlain`. This is a **double-decode**, but it's harmless since `decodeHtmlEntities` is idempotent for well-formed input (no `&amp;amp;` chains).

3. **Known entity matching** (`topic-extractor.ts:236`): `extractKnownEntities(text)` receives the *raw* (pre-decode) `text` parameter. This means curly quotes (`\u2018`) in the original text are NOT normalized before matching against aliases. If an alias contained a curly quote, it would match. But since all aliases in `known-entities.ts` use ASCII, this is currently not a bug -- just fragile.

4. **Heuristic entity extraction** (`topic-extractor.ts:239`): `extractEntities(text)` also receives *raw* text. The capitalization heuristic splits on `.split(/\s+/)` and uses `.replace(/[^a-zA-Z'-]/g, "")`. Curly quotes (`\u2018`, `\u2019`) would be stripped by this regex, so they don't cause incorrect entity detection. **But:** if content contained `&amp;` (un-decoded), it would be split into meaningless fragments.

5. **TF-IDF tokenization** (`topic-extractor.ts:245`): Uses `tokenize(clean)` where `clean = decodeHtmlEntities(text)`. This path is correct.

6. **Bigram extraction** (`topic-extractor.ts:255`): Uses `extractBigrams(clean)` on the decoded text. Correct.

7. **Normalization** (`topic-extractor.ts:142-155`): `normalizeTerm` is called on entity names (line 142, 151) and TF-IDF keywords (line 280). It lowercases + strips plurals. Applied correctly at the right point.

### Missing `decodeHtmlEntities` in word-stats

**BUG:** `tokenizeForWordStats(chunk.content_plain)` at `word-stats.ts:10` calls `tokenize(text)` directly -- no `decodeHtmlEntities` call. Since `content_plain` already went through `stripHtml` in the parser (which decodes entities), this is likely fine for fresh ingestion. However, if `content_plain` were ever populated from a different path (e.g., direct API input), curly quotes would produce different tokens.

**Recommendation:** Add `decodeHtmlEntities` to `tokenizeForWordStats` for defensive consistency, or better yet, centralize the decode step.

### Inconsistency: `extractKnownEntities` and `extractEntities` Skip HTML Decode

At `topic-extractor.ts:236` and `239`, both functions receive the original `text` (before `decodeHtmlEntities`). The decoded version `clean` is computed at line 233 but only used starting at line 245. These two functions should use `clean` instead.

**Fix at `src/services/topic-extractor.ts` lines 236 and 239:**
```typescript
// Change from:
const knownEntities = extractKnownEntities(text);
const heuristicEntities = extractEntities(text);
// Change to:
const knownEntities = extractKnownEntities(clean);
const heuristicEntities = extractEntities(clean);
```

---

## 4. Quality Filtering Location

### 4a. `isNoiseTopic` at Query Time vs INSERT Time

**Current:** `isNoiseTopic` is called at display time in:
- `src/db/topics.ts:48` (getTopTopics)
- `src/db/episodes.ts:52` (getEpisodeTopicsBlended)
- `src/db/chunks.ts:24` (getChunkTopics)

**Problem:** Noise topics ("software", "system", "model", "data", "code", "tool", "product") are stored in the `topics` table, linked in `chunk_topics`, have `usage_count` computed, have `related_slugs` computed, and have `reach` contributions -- all wasted work for topics that will never be displayed.

**Impact:** Every noise topic inflates:
- The `topics` table by ~18 wasted rows (noise-only words not in STOPWORDS)
- `chunk_topics` links -- potentially thousands of rows for generic words like "software" or "system"
- Computation time for `related_slugs` (N+1 query pattern at `ingest.ts:193-212`)
- `reach` calculations (more chunk_topics = inflated reach)

**Recommendation:** Filter noise topics at INSERT time. Add an `isNoiseTopic` check in `enrichChunks` before adding to `uniqueTopics`:

```typescript
// src/jobs/ingest.ts, inside the enrichChunks loop (line 95):
for (const topic of topics) {
  if (isNoiseTopic(topic.name)) continue;  // ADD THIS
  uniqueTopics.set(topic.slug, topic.name);
  ...
}
```

Keep the query-time filter as a safety net, but the DB will be much cleaner.

### 4b. `curateTopics` Precomputation

**Current:** `curateTopics` with phrase subsumption runs at display time in:
- `src/db/topics.ts:187` (getThemeRiverData)
- `src/db/topics.ts:282` (getTopTopicsWithSparklines)

**Analysis:** `curateTopics` depends on the *current* set of phrase topics and their usage counts. If precomputed, it would need to be rerun whenever a new phrase topic is added or usage counts change. Since `finalizeEnrichment` already does a full pass, precomputation IS feasible by adding a `curated` boolean column to the `topics` table.

**Recommendation:** Add a `topics.hidden` boolean column. During `finalizeEnrichment`, after n-gram extraction and usage count updates, run `curateTopics` and set `hidden = 1` for filtered topics. Query-time code then becomes `WHERE hidden = 0`, eliminating repeated JS-side filtering.

### 4c. NOISE_WORDS vs STOPWORDS Consistency

**Overlap (18 words):** better, worse, built, create, basically, essentially, thing, things, people, person, world, point, part, kind, time, work, important, different

These 18 words are in BOTH lists. Since `tokenize` filters STOPWORDS *before* topic extraction, these 18 words can never become topics anyway (they're removed at tokenization). Their presence in NOISE_WORDS is redundant -- they're belt-and-suspenders.

**Noise-only words (35 words) not in STOPWORDS:** harder, easier, faster, slower, bigger, smaller, higher, lower, deeper, wider, longer, shorter, stronger, weaker, aligned, leverage, focused, driven, based, designed, allow, enable, require, involve, include, fundamentally, relatively, software, system, model, data, code, product, tool, tools, products, apps, type, place, idea, value, case, form, record, trust, quality, business, expensive, interesting, injection, labor, hollow, coding, vibe

**Problem:** These 35 words survive tokenization (they pass the STOPWORDS filter) and become topics, only to be filtered at display time. They waste DB space.

**Recommendation:** Move the 35 noise-only words into STOPWORDS. If a word should never be a standalone topic, it should never survive tokenization. Exception: "injection", "labor", "hollow", "coding", "vibe" are deliberately kept as non-stopwords because they're *meaningful as parts of phrases* (e.g., "prompt injection", "cognitive labor", "vibe coding"). These should stay in NOISE_WORDS only, not STOPWORDS, because STOPWORDS would also strip them from word_stats and n-gram detection.

**Refined recommendation:** Move comparative/superlative adjectives and generic verbs to STOPWORDS. Keep the phrase-component words ("injection", "labor", "hollow", "coding", "vibe") in NOISE_WORDS only.

---

## 5. Proposed Pipeline Reorder

### Current Order
```
ingestEpisodesOnly
  -> INSERT episodes, chunks

enrichChunks (per batch)
  -> extractTopics (per chunk, no IDF)
  -> INSERT topics, chunk_topics, episode_topics
  -> tokenizeForWordStats (per chunk)
  -> INSERT chunk_words

finalizeEnrichment (once)
  -> UPDATE usage_count
  -> REBUILD word_stats
  -> COMPUTE reach
  -> mergeCoOccurringTopics (hardcoded)
  -> extractAndStoreNgrams (corpus)
  -> COMPUTE distinctiveness
  -> COMPUTE related_slugs
```

### Proposed Order
```
ingestEpisodesOnly
  -> INSERT episodes, chunks (unchanged)

buildWordStats (NEW: run BEFORE topic extraction)
  -> For each chunk: tokenizeForWordStats(decodeHtmlEntities(content_plain))
  -> INSERT chunk_words
  -> REBUILD word_stats aggregates
  -> COMPUTE distinctiveness on word_stats

extractCorpusNgrams (MOVED: run BEFORE per-chunk topics)
  -> Discover corpus-level bigrams/trigrams
  -> Build known_phrases list

enrichChunks (per batch, ENHANCED)
  -> Load corpus stats (word_stats -> CorpusStats) ONCE at start
  -> Load known_phrases from n-gram results
  -> For each chunk:
     -> clean = decodeHtmlEntities(content_plain)  [ONCE]
     -> extractTopics(clean, 15, corpusStats, knownPhrases)
     -> Filter with isNoiseTopic BEFORE inserting
  -> INSERT topics (excluding noise), chunk_topics, episode_topics

finalizeEnrichment (simplified)
  -> UPDATE usage_count
  -> COMPUTE reach
  -> Mark curated/hidden topics (precompute curateTopics)
  -> COMPUTE related_slugs
  -> DELETE mergeCoOccurringTopics (replaced by corpus n-grams)
```

### Key Changes

| Change | Impact | Files Affected |
|--------|--------|----------------|
| Pass `corpusStats` to `extractTopics` | Enables actual IDF scoring (currently dead code) | `src/jobs/ingest.ts` |
| Run n-grams before per-chunk extraction | Phrases discovered at corpus level feed into per-chunk extraction | `src/jobs/ingest.ts`, `src/services/topic-extractor.ts` |
| Single `decodeHtmlEntities` call per chunk | Consistency; fixes known-entity + heuristic entity decode gap | `src/services/topic-extractor.ts:236,239` |
| Filter noise at INSERT time | Cleaner DB, less wasted computation in finalization | `src/jobs/ingest.ts:95` |
| Remove per-chunk `extractBigrams` | Corpus n-grams are strictly superior | `src/services/topic-extractor.ts:255,316-334` |
| Add `decodeHtmlEntities` to `tokenizeForWordStats` | Defensive consistency | `src/services/word-stats.ts:10` |
| Precompute `curateTopics` result | Eliminates repeated JS-side filtering at query time | `src/jobs/ingest.ts`, `src/db/topics.ts` |
| Move generic noise words to STOPWORDS | Prevents garbage from entering the DB at all | `src/lib/text.ts`, `src/services/topic-quality.ts` |
| Delete `mergeCoOccurringTopics` | Replaced by corpus n-gram discovery | `src/jobs/ingest.ts:218-263` |

### Dependency Graph (Correct Order)

```
chunks.content_plain
  |
  v
decodeHtmlEntities (once per chunk)
  |
  +---> tokenize --> chunk_words --> word_stats --> corpusStats + distinctiveness
  |
  +---> extractCorpusNgrams (all texts) --> known_phrases
  |
  v
extractTopics(clean, corpusStats, knownPhrases)
  |
  +---> isNoiseTopic filter
  |
  v
INSERT topics, chunk_topics, episode_topics
  |
  v
usage_count, reach, related_slugs, curateTopics (hidden flag)
```

### Priority Ranking

1. **HIGH: Pass corpusStats to extractTopics** -- IDF is completely unused during ingestion. This is the biggest quality win.
2. **HIGH: Use `clean` for all three extraction layers** -- Fix the decode inconsistency at topic-extractor.ts lines 236, 239.
3. **MEDIUM: Filter noise at INSERT time** -- Reduces DB bloat and wasted finalization work.
4. **MEDIUM: Add `decodeHtmlEntities` to `tokenizeForWordStats`** -- Defensive consistency.
5. **MEDIUM: Run corpus n-grams before per-chunk extraction** -- Requires pipeline restructuring but yields better phrase topics.
6. **LOW: Remove per-chunk `extractBigrams`** -- Minor cleanup once corpus n-grams feed into extraction.
7. **LOW: Precompute `curateTopics`** -- Performance optimization; current query-time approach works.
8. **LOW: Merge noise words into STOPWORDS** -- Belt-and-suspenders cleanup.
