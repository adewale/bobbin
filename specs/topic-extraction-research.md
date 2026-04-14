# Topic Extraction Quality Research

## Problem

The current TF-IDF pipeline produces 12,000+ topics from ~5,700 chunks. This is 20-50x
too many. Heap's law predicts sqrt(N) to N^0.4 navigational topics: for N=5,700 that's
75-250 topics. The target is 200-500 high-quality navigational topics.

TF-IDF was designed for document retrieval (which documents match a query?), not topic
extraction (what are the key concepts?). With short texts (50-200 words per chunk), there
isn't enough statistical signal per document for TF-IDF to distinguish domain terms from
random English words.

## Algorithms Evaluated

### YAKE (Campos et al., 2020)
- **Best fit for our environment.** Unsupervised, statistical, no training needed.
- Uses within-document features: position, case, relatedness, frequency.
- Naturally produces multi-word keyphrases ("large language model" not "large", "language", "model").
- JS implementation available: `yake-js` on npm.
- Outperforms TF-IDF on short texts because it doesn't depend on corpus-level statistics.
- Paper: Campos, R., et al. "YAKE! Keyword extraction from single documents using multiple local features." *Information Sciences*, 2020.

### RAKE (Rose et al., 2010)
- Splits on stopwords, scores by word degree/frequency ratio.
- ~100 lines to implement in JS. Produces multi-word keyphrases.
- Over-generates on short texts (every stopword-delimited span is a candidate).
- Paper: Rose, S., et al. "Automatic keyword extraction from individual documents." *Text Mining*, 2010.

### TextRank (Mihalcea & Tarau, 2004)
- Graph-based (word co-occurrence + PageRank).
- Works on short texts but favors frequent generic terms.
- Implementable in JS but slower than YAKE for marginal quality difference.
- Paper: Mihalcea, R., Tarau, P. "TextRank: Bringing order into texts." *EMNLP*, 2004.

### KeyBERT (Grootendorst, 2020)
- Embedding-based: finds phrases most similar to document embedding.
- Highest quality but requires a transformer model — impractical in V8 isolate.
- Could work via Workers AI API call (batch processing via queue).

### Topic Models (LDA, NMF, BERTopic)
- Produce fixed K topics (you choose K) rather than per-document keywords.
- Require matrix factorization libraries impractical in V8.
- BERTopic (Grootendorst, 2022) uses embeddings + HDBSCAN — Python only.

## Quality Gates (Literature)

### Document Frequency Threshold
- Yang & Pedersen (1997) established that removing terms with df < 2-5 eliminates 60-80%
  of vocabulary with no loss in classification accuracy.
- For ~5,700 documents:
  - df >= 3: reduces 12,000 → ~2,000-3,000
  - df >= 5: reduces to 500-1,500
  - df >= 10: reduces to 200-500
- **Filter at aggregation time** (finalization), not per-chunk.

### Vocabulary Size Expectations
- Heap's law: V = K * N^beta where beta = 0.4-0.6
- For N=5,700: **75-250 navigational topics**
- 20 Newsgroups benchmark (18,000 docs) yields ~200-300 meaningful topics.

## Recommended Pipeline

| Step | When | What | Impact |
|------|------|------|--------|
| 1 | Enrichment (per-chunk) | YAKE: 3-5 keyphrases/chunk | 50-70% fewer raw extractions |
| 2 | Finalization (corpus-wide) | df >= 5 quality gate | Eliminates singletons + rare noise |
| 3 | Finalization (corpus-wide) | Porter stemming | Collapses inflectional variants |
| 4 | Finalization (corpus-wide) | String similarity clustering (Dice, threshold 0.7) | Merges near-duplicates |
| 5 | Optional (build-time) | Workers AI merge pass | Semantic dedup → 200-300 final |

Steps 2-4 are parallelizable in concept but sequential in practice (each depends on the previous).

## Decision

Implement steps 1-4. Keep known entity extraction as a separate layer (it works well).
YAKE replaces the TF-IDF keyword scoring but entity detection remains unchanged.
