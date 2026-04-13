# NLP Extraction Quality: Research for Cloudflare Workers

## Current State

Bobbin's enrichment pipeline uses four layers: TF-IDF keyword extraction, capitalization-heuristic entity detection, a curated known-entities list (~40 entries), and corpus-level n-gram extraction. Quality is further managed by a 140-word hardcoded noise list and a distinctiveness score derived from an English-baseline word frequency list. The pipeline runs in Cloudflare Workers (30s CPU limit), uses D1 for storage, Workers AI (`@cf/baai/bge-base-en-v1.5` for embeddings), and Vectorize for similarity search.

The core problem: TF-IDF computed over a 50-chunk enrichment batch yields per-batch IDF that is effectively just term frequency. The noise list is a symptom of this -- words like "software", "system", "model" score high because IDF cannot suppress them in small batches.

---

## 1. Better Keyword Extraction

### YAKE (recommended first step)
YAKE is unsupervised, corpus-independent, and designed for single documents. It uses term position, frequency, casing, and word co-occurrence -- no IDF corpus needed. There is a JavaScript implementation (`yake-js` on npm, ~15KB). It works well on short texts (50-500 words), which matches chunk sizes. It can replace TF-IDF in `extractTopics()` with zero infrastructure change.

**Feasibility:** High. Pure JS, no model downloads, runs in <1ms per chunk. Drop-in replacement for the TF-IDF scoring block.

### TextRank
Graph-based, corpus-independent. Builds a word co-occurrence graph and runs PageRank. Good for extractive summarization but slower than YAKE for keyword extraction alone. The `textrank` npm packages are immature. A minimal implementation (build adjacency matrix, iterate PageRank 20 times) is ~80 lines of JS and feasible in Workers.

**Feasibility:** Medium. Worth implementing if YAKE's results are unsatisfying. The graph construction is O(n^2) on vocabulary size per chunk, which is fine for 50-500 word chunks.

### RAKE
Splits on stopwords, scores candidate keywords by degree/frequency ratio. Simple but tends to extract very long phrases ("large language model based autonomous agents") that need post-filtering. Works without IDF.

**Feasibility:** High, but output quality is lower than YAKE for this use case. RAKE over-generates multi-word candidates.

### KeyBERT
Uses embedding similarity between document embedding and candidate word embeddings. Could leverage the existing BGE embeddings via Workers AI, but requires generating embeddings for every candidate word per chunk -- too many API calls. Not practical without batching, and Workers AI embedding calls add ~200ms each.

**Feasibility:** Low for per-chunk extraction. Possible as a post-processing step on the top-N candidates from YAKE.

### Recommendation
Replace TF-IDF with YAKE for per-chunk keyword extraction. YAKE's positional and casing features naturally handle the "Tool at sentence start" vs "OpenAI mid-sentence" distinction better than raw frequency. Keep corpus-level IDF as a re-ranking signal computed from `word_stats` in D1 (see section 3).

---

## 2. Better Entity Detection

### Workers AI for NER
Using `@cf/meta/llama-3.1-8b-instruct` with a prompt like "Extract named entities (people, companies, products) from this text" would dramatically improve entity quality. However:

- **Cost:** Workers AI text generation is metered. At 6K chunks, ~100 input tokens + ~50 output tokens each = ~900K tokens. On the Workers AI free tier this is fine (10K requests/day). On paid, ~$0.01 per chunk = ~$60 total.
- **Latency:** ~500ms-1s per call. At 6K chunks sequentially: ~50 minutes. Batched via Queue (max_concurrency=10): ~5 minutes. This exceeds a single Worker invocation but fits the existing Queue architecture.
- **Quality tradeoff:** LLM-based NER is overkill for chunks where the heuristic works (clear mid-sentence capitalization like "OpenAI announced"). It makes sense for ambiguous cases.

**Hybrid approach (recommended):** Run capitalization heuristics first. Flag chunks where zero entities are found or where all detected entities are single words at sentence starts (uncertain cases). Send only those chunks (~20-30% of corpus) to Workers AI for NER via the existing `ENRICHMENT_QUEUE`. This cuts cost to ~$12-18 and latency to ~1-2 minutes.

### Expanded dictionary-based NER
The current `known-entities.ts` has ~40 entries. A practical expansion: scrape entity names from the corpus itself using the `word_stats` table. Words with `in_baseline=0` and `distinctiveness >= 15` are already identified by `identifyDistinctiveEntities()`. Cross-reference these against a larger dictionary (e.g., a JSON file of Fortune 500 companies, notable tech people, and product names -- ~2K entries, ~50KB). This is a pure data expansion, no code architecture change needed.

---

## 3. Automatic Noise Detection

### Why current IDF fails
`computeCorpusStats()` is called with `chunks.map(c => c.content_plain)` from a single enrichment batch (50-100 chunks). With N=50, IDF = log(50/df) has very low dynamic range. A word appearing in 5/50 chunks scores IDF=2.3; a word in 25/50 scores IDF=0.7. The signal is too weak.

### Fix: use global word_stats from D1
The `word_stats` table already has `doc_count` across the entire corpus (~6K chunks). A word appearing in 3000/6000 chunks gets IDF = log(6000/3000) = 0.69, while one in 10/6000 gets IDF = 6.4. This is meaningful signal.

**Implementation:** Before enrichment, load the top 2000 words from `word_stats` into a `Map<string, number>` (one D1 query, ~50KB). Pass this as `globalIDF` to `extractTopics()`. Use it instead of per-batch `corpusStats`. Words not in word_stats (new vocabulary) get a default high IDF.

This single change would make the hardcoded noise list largely unnecessary. Words like "software" (doc_count=2500) would naturally score low, while "agentic" (doc_count=30) would score high.

### Entropy-based filtering
For remaining edge cases, compute Shannon entropy of each word's distribution across episodes. Words with uniform distribution (appear equally in all episodes) are noise. Words concentrated in specific episodes are signal. Computable from `chunk_words` table:

```sql
SELECT word,
  -SUM((CAST(count AS REAL) / total) * LOG(CAST(count AS REAL) / total)) as entropy
FROM chunk_words
JOIN (SELECT word as w, SUM(count) as total FROM chunk_words GROUP BY word) t ON chunk_words.word = t.w
GROUP BY word
```

Low entropy = uniform = noise. High entropy = bursty = topical. This can replace the hardcoded list with a computed threshold.

---

## 4. Better Phrase Extraction

### PMI from existing data
Pointwise Mutual Information measures whether two words co-occur more than chance predicts. PMI(x,y) = log(P(x,y) / (P(x) * P(y))). The data is already in D1:

- P(x) and P(y): from `word_stats.doc_count / total_chunks`
- P(x,y): count chunks where both words appear (join `chunk_words` on `chunk_id`)

```sql
SELECT cw1.word as w1, cw2.word as w2,
  LOG(CAST(COUNT(DISTINCT cw1.chunk_id) AS REAL) * :total_chunks
    / (ws1.doc_count * ws2.doc_count)) as pmi
FROM chunk_words cw1
JOIN chunk_words cw2 ON cw1.chunk_id = cw2.chunk_id AND cw1.word < cw2.word
JOIN word_stats ws1 ON ws1.word = cw1.word
JOIN word_stats ws2 ON ws2.word = cw2.word
GROUP BY cw1.word, cw2.word
HAVING COUNT(DISTINCT cw1.chunk_id) >= 3
ORDER BY pmi DESC
```

**Caveat:** This query is O(n^2) on vocabulary per chunk. With ~6K chunks and ~50K unique words, the join is expensive. Pre-filter: only compute PMI for word pairs where both words have doc_count >= 3 and doc_count <= total_chunks * 0.3. This eliminates stopwords and rare words, making the query feasible in D1.

**PMI vs raw count:** Current n-gram extraction catches "higher quality" because both words pass stopword filters and co-occur frequently. PMI would penalize this: "higher" and "quality" both appear often independently, so their PMI is low. "Vibe coding" has high PMI because "vibe" rarely appears without "coding" in a tech corpus.

### Log-likelihood ratio
More robust than PMI for low-frequency pairs. Computable from the same data but requires more arithmetic. Implement as a JS function applied to PMI query results rather than in SQL.

---

## 5. Embedding-Based Topic Discovery

### Clustering BGE embeddings
With 768-dim embeddings already in Vectorize for ~6K chunks, k-means or HDBSCAN clustering could discover topic groups. However:

- Vectorize does not support bulk export of vectors or clustering operations. It is query-only (nearest-neighbor search).
- Running k-means in Workers JS on 6K x 768 vectors requires ~18MB of memory and O(k * n * d) per iteration. With k=50 and 20 iterations, this is ~1 billion multiplications. Feasible within 30s CPU, but tight.
- Without HDBSCAN (complex to implement in JS), k-means requires choosing k upfront.

**Practical alternative:** Use Vectorize for "topic labeling." Given a candidate topic name (from YAKE/PMI), generate its embedding via Workers AI, then query Vectorize for the 20 nearest chunks. If the nearest chunks are diverse (from many episodes), the topic is cross-cutting and valuable. If they cluster in 1-2 episodes, it is episode-specific and less useful for navigation.

**BERTopic-style:** Not feasible in Workers. BERTopic requires UMAP (dimensionality reduction) + HDBSCAN (density clustering) + c-TF-IDF, all Python-only with heavy native dependencies.

---

## Priority Ranking

1. **Global IDF from word_stats** (1-2 hours): Load `doc_count` from D1, use as IDF in `extractTopics()`. Eliminates most of the noise list. Highest ROI.
2. **YAKE keyword extraction** (half day): Replace TF-IDF scoring with YAKE. Better handling of short texts, position-aware, no corpus dependency.
3. **PMI phrase scoring** (half day): SQL query on existing `chunk_words` data. Replaces raw n-gram counting, eliminates garbage phrases.
4. **Hybrid LLM entity detection** (1 day): Queue-based Workers AI calls for ambiguous chunks only. Major entity quality improvement.
5. **Entropy-based noise detection** (2-3 hours): Computed from `chunk_words`, replaces hardcoded list.
6. **Vectorize topic validation** (half day): Use embedding similarity to validate/rank extracted topics. Nice-to-have.
