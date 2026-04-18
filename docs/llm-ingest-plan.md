# LLM-at-Ingest Plan For Bobbin

## Goal

Use an LLM once at ingest time to propose topics and entities for each newly discovered episode, then persist those proposals so the rest of the pipeline can be rerun deterministically without reinvoking the LLM.

This changes the role of the LLM from a late-stage extractor to an upstream enrichment source.

## Non-negotiable constraints

- Preserve HTML links from Komoroske's source documents during parsing and ingestion.
- LLM output is only a proposal layer, not the final source of truth.
- LLM invocation happens at the episode level, never at the chunk level.
- LLM invocation happens as close to raw-doc ingestion as possible.
- Once LLM-enriched artifacts are persisted, all downstream pipeline stages must be rerunnable without another LLM call.
- First full run: invoke the LLM on every discovered episode.
- Ongoing cron runs: invoke the LLM only for newly discovered episodes.

## Proposed architecture

### 1. Fetch and preserve raw source data

Input:

- Google Doc HTML

Persist:

- raw source HTML
- parsed links extracted from HTML
- normalized episode/chunk text artifacts
- source and parse versions

Important: link preservation should happen before any text-only reduction so downstream UIs can render source links and future enrichments can use linked context if needed.

### 2. Parse into episodes and chunks

Persist:

- episodes
- chunks
- chunk metadata
- extracted source links per chunk/episode if link ownership can be resolved

### 3. Normalize and tokenize deterministically

Persist:

- `analysis_text` on chunks
- normalization warnings
- chunk words / word stats

This remains the canonical deterministic text layer.

### 4. Episode-level LLM enrichment

Run once per newly discovered episode.

Input to the LLM:

- normalized episode text
- chunk slugs/titles/text excerpts
- maybe deterministic candidate hints (optional in later phases)

Output from the LLM:

- candidate topics
- candidate entities
- canonical names
- aliases
- kind guesses (`entity`, `phrase`, `concept`)
- evidence references (chunk slug + quote)
- confidence

Persist all of it as structured artifacts.

Recommended tables/artifacts:

- `llm_enrichment_runs`
- `llm_episode_candidates`
- `llm_episode_candidate_evidence`

Each run should record:

- model
- model version
- prompt version
- schema version
- created time
- status
- raw JSON response

### 5. Deterministic validation and attribution

Downstream of the persisted LLM output, use deterministic checks only.

Validation rules:

- evidence quote must exist in the referenced chunk text
- entity proposals must boundary-match chunk text
- malformed or unsupported candidates are discarded
- canonicalization remains deterministic

Attribution rules:

- chunk-level attribution only if evidence is real
- no blind propagation of episode topics to all chunks

### 6. Merge with existing deterministic extractors

The LLM should boost, not replace, other sources.

Candidate sources become:

- known entities
- heuristic entities
- phrase lexicon
- Yaket / episode_hybrid candidates
- LLM episode candidates

Recommended combination policy:

- deterministic sources continue to produce candidates
- LLM suggestions can:
  - add new candidates
  - boost confidence/promotability
  - improve canonical naming
  - improve kind assignment
- final promotion is still gated deterministically

### 7. Promotion, consolidation, display

All current deterministic rules still apply:

- corpus-prior rejection
- promotion gating
- episode-spread gating
- phrase thresholds
- entity validation
- merge/prune/archive
- display curation

This is the main economic advantage of the design: all expensive semantic work is done once per episode, and all downstream experimentation is cheap.

## Why this is better than per-chunk LLM extraction

Per-chunk LLM extraction would be:

- far more expensive
- noisier
- harder to manage operationally
- less semantically coherent

Per-episode extraction gives:

- better thematic context
- lower cost
- fewer invocations
- cleaner candidate naming and grouping

Chunk-level precision is preserved by deterministic attribution, not by chunk-level LLM extraction.

## Recommended implementation phases

### Phase 1: Persisted LLM proposals only

Add the schema and prompt, but do not make the LLM authoritative.

Outcome:

- proposals exist in DB
- downstream pipeline can inspect and compare them

### Phase 2: Use LLM proposals as boosting signals

Examples:

- if deterministic and LLM agree, raise promotion confidence
- if LLM proposes a cleaner canonical name, prefer it after deterministic evidence checks
- if LLM proposes a topic with real evidence that deterministic methods missed, let it enter as a candidate

### Phase 3: Benchmark against existing modes

Compare:

- `yaket_bobbin`
- `episode_hybrid`
- `episode_llm_select` (LLM selects from deterministic candidate set)
- later, possibly `episode_llm_direct`

## Testing strategy

This plan should be implemented with explicit testing best practices, not only architectural work.

### Red-Green TDD order

Each implementation slice should begin with failing tests for the new behavior before code is added.

Recommended order:

1. schema and persistence tests for LLM episode artifacts
2. JSON contract tests for LLM outputs
3. deterministic validation tests for evidence / boundary checks
4. integration tests for cached reruns without reinvoking the LLM
5. characterization benchmarks for mode comparison

### Contract tests

The LLM output schema must be tested as a hard contract.

Required tests:

- valid JSON is accepted and normalized
- malformed JSON is rejected cleanly
- missing required fields are rejected
- unsupported `kind` values are rejected
- invalid evidence references are rejected

### Property-based tests

Add PBT for invariants that must hold for all accepted LLM outputs after normalization.

Recommended invariants:

- every accepted proposal has a canonical slug matching `/^[a-z0-9-]+$/`
- every accepted evidence quote exists in the referenced chunk text
- every accepted entity proposal boundary-matches at least one chunk mention
- rerunning downstream processing with the same persisted LLM artifacts is deterministic
- no accepted proposal is promoted without deterministic evidence

### Characterization tests

LLM-at-ingest must be evaluated with characterization tests, not only unit tests.

Required comparisons:

- deterministic-only baseline
- LLM-boosted mode
- future model / prompt upgrades against stored baselines

Characterization should track:

- visible topic count
- weak visible singleton count
- active entities / phrases
- forbidden-topic hit rate
- candidate rows
- accepted / rejected candidates
- chunk-topic links
- merge rows
- archived lineage topics
- total pipeline ms

### Labeled audit set

The labeled audit set is mandatory for semantic evaluation.

Required metrics:

- Precision@5
- Recall@5
- Precision@10
- Recall@10
- entity classification accuracy
- forbidden-topic hit rate

### Failure-path tests

Required failure-path coverage:

- LLM timeout
- malformed JSON response
- partial response
- low-confidence response
- disagreement with deterministic candidates
- missing or invalid evidence references

### Replay and caching tests

The plan depends on reusing persisted LLM artifacts.

Required tests:

- first run invokes LLM once per new episode
- rerunning downstream stages does not invoke the LLM again
- cached artifacts produce stable downstream results across reruns

### Rollout success thresholds

Do not ship the LLM-at-ingest mode unless it:

- matches or improves Precision@5 / @10 and Recall@5 / @10 versus the best deterministic baseline
- lowers forbidden-topic hit rate
- preserves or improves entity precision
- keeps weekly LLM cost within target budget
- allows deterministic downstream reruns with zero additional LLM calls

## How to compare quality

### A. Labeled audit set

Evaluate:

- Precision@5
- Recall@5
- Precision@10
- Recall@10
- forbidden-topic hit rate
- entity classification accuracy
- naming quality

### B. Full-corpus characterization

Track:

- visible topic count
- weak visible singleton count
- active entities
- active phrases
- candidate rows
- accepted/rejected candidates
- chunk-topic links
- merge rows
- archived lineage topics
- total pipeline ms

### C. Human review

Review:

- top visible topics
- disagreements across modes
- renamed topics
- suspicious entities/concepts

## Workers AI model landscape (current)

Models currently visible in Workers AI docs that are relevant to text generation include:

- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `@cf/meta/llama-4-scout-17b-16e-instruct`
- `@cf/google/gemma-4-26b-a4b-it`
- `@cf/qwen/qwen3-30b-a3b-fp8`
- `@cf/openai/gpt-oss-120b`
- `@cf/openai/gpt-oss-20b`
- `@cf/zai-org/glm-4.7-flash`
- `@cf/moonshotai/kimi-k2.5`
- `@cf/mistralai/mistral-small-3.1-24b-instruct`
- `@cf/google/gemma-3-12b-it`
- `@cf/ibm-granite/granite-4.0-h-micro`

Relevant embedding / rerank models include:

- `@cf/google/embeddinggemma-300m`
- `@cf/qwen/qwen3-embedding-0.6b`
- `@cf/baai/bge-m3`
- `@cf/baai/bge-reranker-base`

## Model recommendation for Bobbin

### Best primary model

Recommended primary model for episode-level candidate extraction:

- `@cf/google/gemma-4-26b-a4b-it`

Why:

- newer model family
- strong reasoning/instruction following
- supports function calling and structured outputs
- likely cheaper than 70B-class models
- large enough to handle full-episode thematic extraction reliably

Current published Workers AI pricing:

- input: about `$0.100 / 1M tokens`
- output: about `$0.300 / 1M tokens`

That makes it much cheaper than `llama-3.3-70b-instruct-fp8-fast` for repeated episode-level extraction.

### Strong alternative

- `@cf/meta/llama-4-scout-17b-16e-instruct`

Why:

- newer Llama family
- strong instruct quality
- multimodal support if link/media extraction ever matters later

### Cheapest likely fallback

- `@cf/qwen/qwen3-30b-a3b-fp8`
- or `@cf/ibm-granite/granite-4.0-h-micro` for low-cost experiments

These may be attractive for cron-scale operations, but likely weaker on naming quality and stable structured extraction than Gemma 4 or Llama 4 Scout.

### Expensive but high-confidence option

- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

Why:

- likely strongest overall JSON-following and semantic extraction quality among broadly available open-weight options
- but materially more expensive than Gemma 4

Current published Workers AI pricing:

- input: about `$0.293 / 1M tokens`
- output: about `$2.253 / 1M tokens`

## Recommendation

For Bobbin's weekly episode-level candidate extraction, start with:

- primary: `@cf/google/gemma-4-26b-a4b-it`
- fallback: `@cf/meta/llama-3.1-8b-instruct-fp8` or another cheaper instruct model for retries

If JSON reliability or semantic quality is not good enough, move up to:

- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

## Cost shape

Episode-level LLM extraction is viable because Bobbin has about:

- 80 episodes total
- roughly 1 new episode per week

That means:

- full backfill cost is bounded and one-time
- weekly refresh cost is tiny relative to per-chunk extraction
- downstream reruns remain free of further LLM cost

## Best first experiment

Do not start with direct-from-text final topic extraction.

Start with:

- `episode_llm_select`

Flow:

1. deterministic candidate generation (`episode_hybrid` / known entities / phrase lexicon)
2. LLM selects/refines top episode topics from that candidate set
3. deterministic chunk attribution and promotion

This keeps:

- low hallucination risk
- lower token cost
- strong explainability
- deterministic rerun behavior
