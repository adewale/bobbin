N-gram Analysis in Bobbin

## Problem

Single-word tokenization produces garbage topics. "prompt" alone is meaningless — it only matters as "prompt injection." "coding" only matters as "vibe coding." The TF-IDF extractor surfaces high-frequency single words that are fragments of meaningful phrases, polluting the topics grid with noise like "harder", "aligned", "apps."

## Approach

Three layers work together: corpus-level n-gram extraction discovers phrases, phrase subsumption suppresses their component words, and quality filtering removes noise.

### Layer 1: Corpus-level n-gram extraction

`src/services/ngram-extractor.ts`

Per-chunk bigram extraction fails because chunks are too short (50-500 words) for any bigram to appear multiple times. Instead, we extract bigrams and trigrams across the entire corpus:

1. For each chunk, tokenize into words (lowercase, strip punctuation, drop stopwords)
2. Generate all bigrams (word pairs) and trigrams (word triples)
3. Count how many distinct chunks (documents) each n-gram appears in
4. Filter: keep phrases with count >= 5 and doc_count >= 3

This surfaces phrases like "prompt injection" (23 chunks), "vibe coding" (22), "cognitive labor" (20), "mental model" (7), "pace layer" (9) that span the corpus.

The n-gram extraction runs during enrichment (not at query time). Results are stored as topics with `kind = 'phrase'`.

### Layer 2: Phrase subsumption

`src/services/topic-quality.ts`

When a phrase topic exists, its component words may be noise as standalone topics. Subsumption logic:

1. Build a set of words that are components of established phrase topics
2. For each single-word topic, check if it's a phrase component
3. If the phrase topic's usage is >= 40% of the single word's usage, suppress the single word

Example: "coding" has 38 uses. "vibe coding" has 22 uses. 22/38 = 58% > 40% threshold. "coding" is suppressed from the grid. But "software" (273 uses) has no phrase that subsumes more than 40% of it, so it stays.

The 40% threshold is a judgment call. Lower catches more subsumption but risks hiding words that genuinely stand alone in other contexts. Higher is more conservative.

### Layer 3: Quality filtering

`src/services/topic-quality.ts`

A curated noise word list removes terms that are never meaningful as standalone topics:

- Comparative adjectives: harder, easier, faster, bigger, better, worse
- Generic verbs/adjectives: aligned, leverage, focused, driven, allow, create
- Generic nouns: apps, tool, product, thing, people, world, point, value
- Words that only make sense in phrases: injection, labor, hollow

This list is intentionally aggressive. It's better to show 15 high-quality topics than 20 with 5 garbage entries.

### How they combine

During enrichment:
1. N-gram extraction runs on all chunk texts → creates phrase topics in DB
2. Quality curation runs at query time (in getTopTopicsWithSparklines and getThemeRiverData)
3. The topics grid shows a unified view: phrases and single words interleaved, ranked by quality

At display time:
1. Fetch 60 candidate topics (3x the display limit)
2. Apply curateTopics() — removes noise, suppresses subsumed words
3. Take the top 20 survivors
4. Fetch sparkline data for those 20

### What we don't do

- **LDA / BERTopic clustering** — these would discover latent topic groups but require Python. The spec mentions them as future work.
- **Pointwise Mutual Information (PMI)** — a more statistically rigorous way to score collocations than raw co-occurrence. Could replace the simple count-based n-gram extraction.
- **Variable-length phrases** — we only do bigrams and trigrams. 4-grams and beyond are too sparse in this corpus.
- **Cross-document phrase discovery** — we count n-grams per-chunk but don't look at phrases that span chunk boundaries.

### Data flow

```
chunk content_plain
       │
       ▼
tokenize → single words → TF-IDF → scored single-word topics
       │
       ▼
bigrams/trigrams → count across corpus → phrase topics (kind='phrase')
       │
       ▼
known-entities.ts → entity topics (kind='entity')
       │
       ▼
All three merge → stored in topics table with chunk_topics links
       │
       ▼
At display time: curateTopics() filters noise + suppresses subsumed words
```
