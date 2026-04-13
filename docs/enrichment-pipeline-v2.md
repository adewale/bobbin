Enrichment Pipeline v2

## Problems with v1

1. **IDF is dead code** — extractTopics called without corpus stats, falls back to pure TF
2. **N-grams run too late** — corpus phrases discovered after per-chunk extraction
3. **Noise filtered at display time** — garbage topics stored, computed, then discarded
4. **Triple tokenization** — each chunk tokenized 3 times with different regexes
5. **HTML decode inconsistency** — extractKnownEntities gets raw text, tokenize gets decoded
6. **55% of topics have usage=1** — massive bloat from single-occurrence words
7. **40/50 top single-word topics are generic noise** — system, software, model, data...

## New pipeline order

### Phase 1: Per-chunk tokenization (enrichChunks, per batch)

For each unenriched chunk:
1. Decode HTML entities (including curly quotes)
2. Tokenize ONCE — shared between topic extraction and word stats
3. Build chunk_words from the shared tokenization
4. Extract topics WITH noise filter at insert time:
   - Known entities (curated list) — always included
   - TF-IDF keywords — using precomputed corpus IDF when available
   - Skip noise words before insertion (isNoiseTopic check)
5. Insert topics, chunk_topics, episode_topics

### Phase 2: Corpus-level finalization (finalizeEnrichment, once)

After all chunks are enriched:
1. Rebuild word_stats aggregates
2. Compute corpus IDF stats (for future enrichment runs)
3. Run corpus n-gram extraction — discover phrase topics
4. Merge co-occurring split concepts
5. Recalculate usage_count from actual chunk_topics
6. Precompute distinctiveness from word_stats
7. Precompute reach for chunks
8. Precompute related_slugs (top 5 co-occurring)

## Key changes from v1

| Aspect | v1 | v2 |
|--------|----|----|
| Noise filtering | Display time (3 query files) | Insert time (enrichChunks) |
| IDF | Dead code (not passed to extractTopics) | Precomputed, passed when available |
| N-grams | In finalizeEnrichment only | Same, but per-chunk bigrams removed (redundant) |
| Tokenization | 3× per chunk (TF-IDF, bigrams, word stats) | 1× shared tokenization |
| Entity kind | Set by UPDATE after INSERT OR IGNORE | Set during INSERT + UPDATE fallback |
| HTML decode | Inconsistent (raw vs decoded) | Always decoded before any processing |

## Issues fixed (all resolved)

1. **Pass corpus IDF stats to extractTopics** — done: `enrichChunks` calls `computeCorpusStats` and passes it to `extractTopics`
2. **Remove per-chunk bigrams** — done: corpus-level n-gram extraction in `finalizeEnrichment` replaces per-chunk `extractBigrams`
3. **Add isNoiseTopic check at INSERT time** — done: `enrichChunks` filters noise before insertion (entities exempt)
4. **Fix extractKnownEntities to use decoded text** — done: both `extractKnownEntities` and `extractEntities` now use `clean` (decoded) text
5. **Expand NOISE_WORDS** — done: ~140 entries covering generic nouns, verbs, adjectives
6. **Add missing entities** — done: known-entities list expanded
7. **Unify tokenization** — done: single `decodeHtmlEntities` call, shared tokenization path
8. **Add substring phrase dedup** — done: handled in `finalizeEnrichment`
