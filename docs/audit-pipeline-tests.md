# Enrichment Pipeline Test Quality Audit

## Step 1: Sabotage Detection

**No sabotage found.** The test suite is clean:

- **No empty test bodies** -- every `it()` block contains assertions.
- **No assertion-only `toBeDefined()`/`toBeTruthy()` tests** -- the 2 uses of `toBeTruthy()` (entity-detection.test.ts:38, topic-extractor.test.ts:17) are paired with additional structural assertions (regex match, `.not.toContain`). The 3 uses of `toBeDefined()` (search-topics.test.ts, query-parser.test.ts, distinctiveness.test.ts) are all followed by deeper assertions on the defined value.
- **No try/catch swallowing assertions** -- the only try/catch in test files is in html-parser.property.test.ts:49 for a file-existence check (not around assertions).
- **No unconditional `.skip` or `xdescribe`** -- all `.skipIf()` calls are conditional on local data availability (`!hasLocalData`, `!hasData`), which is correct for tests that depend on optional local fixtures.
- **No `console.log` in test files** at all.

## Step 2: Assertion Density

| Test File | Tests | Total Assertions | Avg/Test | Flag? |
|---|---|---|---|---|
| `finalization.test.ts` | 5 | 18 | 3.6 | OK |
| `enrichment.test.ts` | 7 | 14 | 2.0 | **BELOW 3** |
| `phased-ingest.test.ts` | 11 | 19 | 1.7 | **BELOW 3** |
| `topic-extractor.test.ts` | 6 | 9 | 1.5 | **BELOW 3** |
| `topic-extractor.property.test.ts` | 6 | ~6 (but fc.assert runs 100 trials each) | N/A (PBT) | OK |
| `topic-quality.test.ts` | 7 | 10 | 1.4 | **BELOW 3** |
| `ngram-extractor.test.ts` | 4 | 8 | 2.0 | **BELOW 3** |
| `entity-detection.test.ts` | 10 | 18 | 1.8 | **BELOW 3** |

**6 of 8 files are below the 3-assertion-per-test threshold.** The typical pattern: a test extracts data and makes a single `toContain` or `toBeGreaterThan` assertion without checking complementary conditions. For example, `topic-extractor.test.ts` "extracts top keywords" asserts that `ecosystem` and `platform` appear but does not assert that stop words or noise words are absent in the same test.

## Step 3: Untested Code Paths

### 3a. topic-extractor.ts -- extractTopics

| Path | Tested? | Risk |
|---|---|---|
| IDF path (corpusStats provided) | **YES** -- `topic-system.test.ts` passes corpusStats to extractTopics and verifies rare > common scoring | Low |
| Known entity extraction with actual entity names | **YES** -- `entity-detection.test.ts` tests OpenAI, Stratechery, Google, Ben Thompson from curated list | Low |
| Noise filter interaction (extractTopics returns topic that isNoiseTopic would filter) | **NOT DIRECTLY TESTED** -- `isNoiseTopic` has zero dedicated unit tests. It's only tested indirectly through finalization.test.ts noise cleanup. No test verifies that `enrichChunks` actually filters noise at insert time (line 101 of ingest.ts). | **HIGH** |
| normalizeTerm edge cases (empty string, single char) | **PARTIAL** -- topic-normalize.test.ts tests short words ("this", "bus") but NOT empty string `""` or single char `"a"`. PBT uses minLength=4, so empty/short inputs are never generated. | Medium |

### 3b. topic-quality.ts -- curateTopics

| Path | Tested? | Risk |
|---|---|---|
| Phrase subsumption with realistic data | **YES** -- topic-quality.test.ts tests "coding" suppressed by "vibe coding" at 40% threshold, and "ecosystem" preserved when phrase usage is too low | Low |
| NOISE_WORDS correctness verification | **NOT TESTED** -- no test enumerates or spot-checks the NOISE_WORDS set. `isNoiseTopic` itself has ZERO dedicated unit tests despite being called in 5 production locations (ingest.ts x2, topics.ts, chunks.ts, episodes.ts). | **HIGH** |
| `isNoiseTopic` function directly | **ZERO TESTS** -- not a single test calls `isNoiseTopic` directly. All coverage is incidental through integration tests. | **HIGH** |

### 3c. ingest.ts -- enrichChunks

| Path | Tested? | Risk |
|---|---|---|
| IDF integration end-to-end | **PARTIAL** -- `enrichChunks` calls `computeCorpusStats` internally, but no test verifies that the resulting topics differ from a non-IDF run. The test just checks `chunksProcessed > 0`. | Medium |
| Noise filter at INSERT time | **NOT TESTED** -- no test verifies that enrichChunks filters noise words before insertion. A test should seed a chunk with text that would produce a noise-word topic and verify it's absent from chunk_topics. | **HIGH** |
| Entity kind UPDATE | **NOT TESTED** -- lines 114-119 of ingest.ts update topics to `kind='entity'` after INSERT OR IGNORE. No test verifies this happens. If this fails, entity topics would have `kind='concept'` and the entity validation in finalization would skip them. | **HIGH** |
| Queue dispatch (vs fallback) | **NOT TESTED** -- all tests pass no queue, so only the inline fallback path is exercised. The queue dispatch path (line 211, 239) is completely untested. | Medium (queue is optional) |

### 3d. queue-handler.ts

| Function | Tested? | Risk |
|---|---|---|
| `handleComputeRelated` | **ZERO TESTS** | Medium |
| `handleAssignNgram` | **ZERO TESTS** | Medium |
| `handleEnrichmentBatch` | **ZERO TESTS** | Medium |

The entire `queue-handler.ts` file has no test file. These functions duplicate logic from `finalizeEnrichment` inline paths, so the logic is indirectly tested, but the message parsing, ack/retry, and error handling are completely uncovered.

### 3e. ngram-extractor.ts -- extractCorpusNgrams

| Path | Tested? | Risk |
|---|---|---|
| Expanded NGRAM_STOP list | **NOT TESTED** -- no test verifies that stop words from NGRAM_STOP are excluded from results. The test only checks "prompt injection" appears, not that garbage phrases are absent. | Medium |
| Trigrams | **NOT TESTED** -- zero test cases for trigrams. All tests use bigrams only ("prompt injection"). The trigram code path (lines 51-58) is uncovered. | Medium |
| Curly quote normalization | **NOT TESTED** -- line 33 normalizes \u2018\u2019\u201C\u201D to straight quotes. No test passes curly-quoted text. | Low |

## Step 4: Property-Based Test Gaps

| Function | Has "never crashes" PBT? | Risk |
|---|---|---|
| `extractTopics(arbitrary_string)` | **YES** -- entity-detection.test.ts line 139 | OK |
| `extractKnownEntities(arbitrary_string)` | **YES** -- entity-detection.test.ts line 131 | OK |
| `isNoiseTopic(arbitrary_string)` | **NO** -- zero PBT coverage | **HIGH** -- called on every topic at insert time AND at display time |
| `extractCorpusNgrams([arbitrary_strings])` | **YES** -- ngram-extractor.test.ts line 39 | OK |
| `curateTopics(arbitrary_topics)` | **YES** -- topic-quality.test.ts line 74 | OK |
| `normalizeTerm(arbitrary_string)` | **PARTIAL** -- PBT uses minLength=4, missing empty/short strings | Low |

## Step 5: Pipeline Correctness (Full Flow Tests)

**Partial coverage.** The full pipeline `Chunk text -> extractTopics -> topics in DB -> displayed on page` is tested in pieces but never end-to-end in a single test:

1. `ingestion-roundtrip.test.ts` tests HTML -> parse -> DB and verifies topics exist, but does not check specific topic names or kinds.
2. `topic-marginalia.test.ts` verifies that topics appear on chunk/episode pages, but uses manually-seeded DB data rather than running the enrichment pipeline.
3. **No test seeds a chunk with "OpenAI announced..." and verifies:**
   - extractTopics returns an entity result for OpenAI (tested in entity-detection.test.ts but separately)
   - The topic is inserted with `kind='entity'` (NOT TESTED)
   - The chunk detail page shows "OpenAI" in the marginalia (NOT TESTED)

**There is no single test that exercises the full pipeline from raw text to rendered page.** The gap between enrichment tests (which verify DB state) and route tests (which use manually-seeded data) means a bug in the glue code could go undetected.

## Step 6: Golden File Opportunities

**No golden file tests exist.** There are no snapshot tests (`toMatchSnapshot`, `toMatchInlineSnapshot`) or golden file comparisons anywhere in the codebase.

`html-parser.ts` is a transformation pipeline (Google Docs HTML -> structured episodes/chunks) that is ideal for golden file testing:
- The current tests verify structural properties (count, positions, content presence) but not the exact output.
- A golden file test would catch regressions in title generation, chunk boundary detection, and HTML stripping that structural tests miss.

`html-parser.property.test.ts` does have conditional tests against real local data, but these are `skipIf` guarded and won't run in CI.

## Priority Risk Summary

### CRITICAL (data quality bugs possible in production)

1. **`isNoiseTopic` has zero direct tests** despite being a critical filter called at 5 points in production code (2x in ingest.ts during insert + cleanup, and 3x in DB query layers for display). If NOISE_WORDS is wrong, bad topics appear on every page. Anyone could add/remove a word from NOISE_WORDS with no test failure.

2. **Entity `kind` UPDATE path untested** (ingest.ts:114-119). If this code silently breaks, entities would be stored as `kind='concept'`, the finalization entity-validation step would skip them, and false entity assignments would persist in the DB.

3. **Noise filter at INSERT time untested** (ingest.ts:101). The enrichChunks function filters noise topics before DB insertion, but no test verifies this behavior. If the filter breaks, noise words would be inserted and only partially caught by the finalization cleanup pass.

### HIGH (significant gaps)

4. **No end-to-end pipeline test** from raw text through enrichment to rendered page. The enrichment and route tests use different data sources, so integration bugs between them are invisible.

5. **`queue-handler.ts` entirely untested** -- 88 lines of production code with zero test coverage, including message parsing, error handling with retry logic, and batch processing.

6. **Trigram extraction untested** -- the trigram code in ngram-extractor.ts has zero test coverage. If trigrams are broken, multi-word phrase topics of 3 words would never be discovered.

### MEDIUM (quality gaps, lower immediate risk)

7. **Low assertion density** across 6 of 8 key test files. Tests verify the happy path but often omit complementary assertions (e.g., checking that unwanted items are absent).

8. **No golden file tests** for html-parser.ts despite it being a classic transformation pipeline.

9. **NGRAM_STOP list not verified** by any test -- garbage phrases could leak through if stop words are missing.

10. **`normalizeTerm` PBT skips empty/short strings** due to `minLength=4` constraint in fast-check.
