# Yaket Tuning For Bobbin

Bobbin now supports three extractor modes via `TOPIC_EXTRACTOR_MODE`:

- `naive`
- `yaket`
- `yaket_bobbin`

`yaket_bobbin` is a Bobbin-specific tuning profile built on top of the published npm package `@ade_oshineye/yaket`.

## Goal

Raw Yaket improved structural cleanliness over the old Bobbin YAKE-like extractor, but still surfaced weak visible singletons and story-local curiosities such as `agentic` and `saruman`.

The Bobbin tuning profile optimizes for corpus-navigation quality rather than generic single-document keyword quality.

Primary optimization goals:

- reduce visible weak singletons
- reduce visible topic count without hurting core entity coverage
- preserve or improve multi-word phrase quality
- reduce late churn: pruning, merging, lineage archiving
- reduce total pipeline cost versus raw Yaket

## Tunings

These are implemented in `src/services/yake-runtime.ts`.

### 1. Bobbin text processor

Uses Bobbin's canonical normalization and tokenization instead of the package defaults.

What it does:

- runs `normalizeChunkText()` first
- splits sentences on normalized punctuation
- tokenizes using Bobbin's shared token stream

Why:

- keeps Yaket aligned with the text seen by the rest of the pipeline
- avoids extractor-vs-pipeline normalization drift

Optimized metrics:

- provenance stability
- duplicate-topic rate
- late merge rate

### 2. Bobbin stopword provider

Starts from Yaket's default language stopwords, then adds:

- Bobbin's internal stopwords
- small Bobbin-specific filler additions such as `bits`, `bobs`, `really`, `actually`, `thing`, `things`, `stuff`

Why:

- suppress newsletter/meta-discourse junk earlier

Optimized metrics:

- candidates generated
- candidates rejected early
- noise-topic survival rate

### 3. Candidate normalizer

Normalizes Yaket candidates before dedup/filtering:

- Bobbin text normalization
- punctuation stripping
- lowercase normalization
- light plural/singular cleanup
- apostrophe cleanup

Why:

- collapse easy variants before they reach canonicalization and merge passes

Optimized metrics:

- duplicate-topic rate
- plural/singular duplicate count
- topics merged later

### 4. Candidate filter

Rejects candidates before they enter Bobbin's topic pipeline when they look structurally weak.

Current policy:

- reject empty or malformed candidates
- reject noise-topic matches
- reject candidates starting/ending with stopwords
- reject candidates containing Bobbin-specific filler tokens
- for single-word candidates:
  - require length >= 5
  - require occurrences >= 2
  - require sentence spread >= 2
  - reject `isWeakSingletonTopic(...)`
- for multi-word candidates:
  - reject weak one-off phrases with poor score support

Why:

- Bobbin needs durable navigational topics, not just locally salient chunk keywords

Optimized metrics:

- visible topic count
- weak visible singleton count
- candidates inserted
- topics pruned later
- archived lineage topics

### 5. Keyword scorer

Applies a Bobbin-biased rescoring pass over Yaket keyword details.

Current biases:

- reward multi-word phrases
- reward repeated occurrences
- reward wider sentence spread
- penalize weak singletons
- penalize one-off singletons
- penalize adjective/participle-ish endings on weak singletons

Why:

- Bobbin prefers stable technical phrases over single-document curiosities

Optimized metrics:

- top visible topic quality
- weak visible singleton count
- phrase share of active topics

### 6. Dedup tuning

`yaket_bobbin` uses:

- `dedupFunc: "jaro"`
- `dedupLim: 0.82`
- `windowSize: 2`

Why:

- slightly more aggressive early dedup
- better phrase cohesion for Bobbin-sized chunks

Optimized metrics:

- near-duplicate string cluster count
- merge rows
- archived lineage topics

## Characterization Metrics

Characterization scripts:

- `npm run characterize:pipeline:yaket`
- `npm run characterize:pipeline:yaket_bobbin`

These run the real staged pipeline on the cached Komoroske corpus and emit:

- sources / episodes / chunks
- topics total / active / visible
- active entities / active phrases
- suppressed active topics
- weak visible singleton count
- candidate rows / accepted / rejected
- merge rows
- chunk-topic links
- archived lineage topics
- active topics with provenance
- pipeline wall time rollups from `pipeline_runs`

## Current Results

Full-corpus comparison on the same 80 episodes / 5,771 chunks:

| Metric | `yaket` | `yaket_bobbin` | Better |
|---|---:|---:|---|
| Topics total | 266 | 213 | `yaket_bobbin` |
| Active topics | 265 | 212 | `yaket_bobbin` |
| Visible topics | 242 | 210 | `yaket_bobbin` |
| Active phrases | 171 | 176 | `yaket_bobbin` |
| Active entities | 25 | 25 | tie |
| Suppressed active topics | 23 | 2 | `yaket_bobbin` |
| Weak visible singletons | 32 | 6 | `yaket_bobbin` |
| Candidate rows | 62,681 | 14,498 | `yaket_bobbin` |
| Accepted candidates | 27,047 | 11,743 | mixed |
| Rejected candidates | 35,634 | 2,755 | `yaket_bobbin` |
| Chunk-topic links | 4,662 | 3,717 | `yaket_bobbin` |
| Merge rows | 107 | 91 | `yaket_bobbin` |
| Archived lineage topics | 19,983 | 7,602 | `yaket_bobbin` |
| Total pipeline ms | 32,705 | 27,374 | `yaket_bobbin` |

Observed qualitative improvement:

- raw `yaket` surfaced weak visible terms like `agentic` and `saruman`
- `yaket_bobbin` removed those and retained stronger durable phrases such as:
  - `disconfirming evidence`
  - `abundant cognitive labor`
  - `tech industry`

Entity coverage stayed unchanged for the sampled core entities:

- `claude`: 152
- `chatgpt`: 132
- `openai`: 68
- `google`: 87
- `anthropic`: 48
- `meta`: 58

## Practical Recommendation

`yaket_bobbin` is better than raw `yaket` for Bobbin.

It is not yet the production default because the final production choice should still be based on a labeled audit set with:

- Precision@5 / Precision@10
- Recall@5 / Recall@10
- manual review of top visible topics

Until then:

- keep `naive` as the deployed default
- use `yaket` and `yaket_bobbin` through the runtime switch and characterization harness for comparison
