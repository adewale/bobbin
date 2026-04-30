# Correct-By-Construction Pipeline Spec

## Principle

Build the Bobbin pipeline so invalid published state is impossible, not merely repaired later.

This means:

- every published invariant has one authoritative construction step
- raw ingestion, staging, and published data are separate layers
- public routes read only validated published outputs
- failures keep the last known-good published snapshot live

## Why this spec exists

The current pipeline is far more stable than the original mutable version, but it still inherits the shape of a live repair system:

- raw and derived topic state share the same hot tables
- cleanup and suppression remain part of normal correctness
- public routes still depend on support-policy helpers rather than reading a prevalidated published topic universe

This spec captures how we would redesign the pipeline if we adopted the rule:

> defense-in-depth is an antipattern; make bad published state unrepresentable.

## Goals

- make invalid published topic state unrepresentable
- make incremental rebuilds equivalent to full rebuilds
- make summary and topic routes consume the same published topic universe
- separate code rollback from published-data rollback explicitly
- measure whether the redesign improves correctness, stability, and operability before and during rollout

## Non-goals

- preserve every current table shape
- support arbitrary stale schemas at runtime in business queries
- let routes repair or reinterpret raw pipeline state dynamically

## Target storage model

### Raw layer

Immutable or append-only source truth.

- `sources`
- `episodes_raw`
- `chunks_raw`
- `source_html_chunks`
- raw LLM proposal artifacts
- raw deterministic candidate artifacts

Properties:

- reparsing produces new derived artifacts, not hot fixes to published rows
- raw source remains the recovery boundary

### Staging layer

Deterministic build workspace.

- `chunk_candidates_stage`
- `topic_resolution_stage`
- `chunk_topic_edges_stage`
- `topic_metrics_stage`
- `topic_similarity_stage`
- `period_metrics_stage`

Properties:

- safe to truncate and rebuild
- never read by public routes

### Published layer

The only layer routes should query.

- `published_topics`
- `published_chunk_topics`
- `published_episode_topics`
- `published_topic_similarity`
- `published_period_metrics`
- optional precomputed browse/sparkline tables if needed for route speed

Properties:

- all rows already satisfy visibility/support/alias/entity invariants
- published counts derive from published child rows, not denormalized guesses
- snapshot version is explicit

## Published invariants

### Topic invariants

- every published topic is canonicalized
- every published topic passes support policy
- every published topic passes visibility/noise policy
- every published entity has supporting evidence
- no unresolved aliases or duplicates exist in published topics
- no published topic is orphaned

### Edge invariants

- every published chunk-topic edge points at a published topic
- every published episode-topic edge is derived from published chunk-topic edges only
- all route-visible counts derive from published edges

### Metric invariants

- `episode_support`, `burst_score`, `related_slugs`, summary cards, movers, and archive contrast all derive from the same published topic universe
- topic pages and summary pages cannot disagree on visibility because they query the same published outputs

## Pipeline shape

### A. Source ingest

Input:

- Google Doc HTML

Output:

- raw episodes/chunks/artifacts only

### B. Candidate extraction

Input:

- raw chunks
- phrase lexicon
- known entities
- cached episode-level LLM proposals

Output:

- candidate rows only

Important:

- may overgenerate
- must not publish anything directly

### C. Canonical topic resolution

Input:

- candidate rows across the affected corpus subgraph

Output:

- canonical topics plus accepted chunk-topic edges

This absorbs what is currently spread across cleanup/finalization:

- alias merge
- phrase dedup
- entity evidence validation
- support gating
- noise rejection
- canonical naming

These are construction rules, not post-hoc repair steps.

### D. Metric derivation

Input:

- canonical staging topics
- canonical staging edges

Output:

- support
- burst
- similarity
- period/topic aggregates
- browse-card metrics

### E. Atomic publish

Input:

- complete staging outputs

Output:

- next published snapshot

Requirements:

- publish all-at-once or not at all
- last known-good snapshot remains live if build fails
- routes resolve a single active snapshot/version

## Incremental rebuild contract

For any chunk-level delta:

`incremental(corpus, delta) == full_rebuild(corpus_after_delta)`

at the published-output level.

Incremental work should track:

- touched chunks
- candidate topics emitted by those chunks
- canonical topics that could merge/split with them
- neighboring edges needed for similarity/support recomputation

Incrementality should never mean “best effort local cleanup”. It must mean “same published result, smaller build surface”.

## Query model

Public routes must not encode topic-support or similarity fallback policy.

Routes should query:

- published topic tables
- published period metrics
- published similarity tables

Routes should not:

- reapply support thresholds
- retry alternate semantic interpretations
- repair stale topic state dynamically

## Schema/version policy

Correct-by-construction implies fail-fast schema handling.

Requirements:

- schema version stored explicitly (for example `schema_meta`)
- startup/build path validates expected schema version
- local dev fails clearly if migrations are behind
- migration chain remains the only source of schema truth

This intentionally moves us away from route-level schema compatibility fallbacks over time.

## Benchmarks and assessment

We should not attempt this redesign without explicit before/after measurement.

### Existing baseline tools

- `scripts/characterize-pipeline.mjs`
- `pipeline_runs`
- `pipeline_stage_metrics`

These already provide:

- visible topic counts
- candidate/merge/prune rollups
- pipeline timing
- top visible topic lists

### New baseline tools required

#### 1. Invariant metrics

Added in this pass:

- `scripts/audit-invariant-metrics.mjs`

Purpose:

- capture current invariant violations and drift-sensitive counts for local or remote D1

Key metrics:

- `visible_topics_support_eligible`
- `visible_topics_support_ineligible`
- `orphan_topics`
- `duplicate_topic_slugs`
- `drifted_episode_chunk_counts`
- `visible_topics_missing_related_slugs`
- `active_entities_unverified`

#### 2. Comparison harness

Added in this pass:

- `scripts/compare-pipeline-baselines.mjs`

Purpose:

- compare two characterization outputs or two invariant-audit outputs
- surface deltas in corpus shape and pipeline cost before adopting the new architecture

#### 3. Rollback bundle capture

Added in this pass:

- `scripts/export-rollback-bundle.mjs`

Purpose:

- export restorable D1 tables as timestamped data-only SQL files
- record which tables were skipped (for example internal tables and FTS virtual/shadow tables)
- create a manifest that ties the bundle to a git SHA and restore notes
- emit a dependency-safe restore order plus a generated `restore.sh`

### Minimum acceptance benchmarks before migration

Before implementing the new pipeline architecture, we should have stable baseline captures for:

- current characterization output
- current invariant audit output
- top visible topic list
- key entity counts
- key summary surfaces (`/summaries`, `/summaries/:year`, `/topics`, `/episodes/:slug`) via route/browser snapshots

### Success criteria for the redesign

The redesign should be considered better only if it improves or preserves:

#### Correctness

- zero published orphan topics
- zero visible support-ineligible topics
- zero topic/summary visibility disagreements
- zero route-level support fallback logic in public handlers

#### Stability

- no partial publish on failed builds
- incremental rebuild output matches full rebuild output
- routes serve the last known-good snapshot during build failure

#### Operability

- lower variance in finalization/build timing
- queryable snapshot/version metadata per run
- deterministic rollback instructions tested on real data bundles

#### Product quality

- top visible topics remain navigationally sane
- summary cards/panels stay materially consistent with current product expectations
- no regression in route/browser smoke tests on key surfaces

## Rollback story for published data

### Current limitation

Cloudflare Worker rollback only rolls back code. It does **not** roll back D1 contents or bindings.

That means data rollback must be an application-level strategy.

### Near-term rollback story

Before major pipeline changes:

1. capture a rollback bundle with `scripts/export-rollback-bundle.mjs`
2. capture invariant metrics with `scripts/audit-invariant-metrics.mjs`
3. record the active Worker version ID
4. ship code gradually or behind controlled activation if possible

If rollback is needed:

1. roll Worker code back with `wrangler rollback`
2. restore data into a fresh D1 target from the rollback bundle
3. re-apply migrations first, then import the rollback bundle's data-only table exports so indexes, triggers, and FTS virtual tables are recreated from code
4. re-point bindings or restore published snapshot pointers as needed

### Target rollback story under the new design

Once published snapshots exist, rollback should become:

- code rollback: Worker version rollback
- data rollback: active published snapshot pointer rollback

That is the desired end state. No hot-table mutation should be required to recover a prior published view.

## Cloudflare best-practice implications

This spec is constrained by current Cloudflare guidance.

### Workers deployments and rollback

Relevant guidance:

- Workers gradual deployments
- Workers rollback

Implications:

- use gradual deployments for code changes to the new pipeline coordinator
- use version metadata / deployment IDs in manifests and smoke tests
- do **not** assume Worker rollback restores D1 data; keep data rollback separate
- keep backwards/forwards compatibility during rollout windows because mixed-version traffic is possible

### D1 import/export and query behavior

Relevant guidance:

- D1 query patterns and SQL usage
- D1 import/export limitations

Implications:

- use foreign keys and authoritative relational constraints where possible
- keep rollback/export tooling aware of virtual-table limitations (FTS and shadow tables must come from migrations, not export files)
- design snapshot export around explicit manifests and table-level recovery instead of assuming one-click full DB restore
- prefer query shapes that remain simple, composable, and indexable in staging/published layers

Current practical limitation:

- `wrangler d1 export` does not currently support `--persist-to`, so rollback-bundle export supports the default local D1 state or `--remote`, not arbitrary custom persisted local-state directories.

### Queues batching/retries

Relevant guidance:

- explicit ack / retry
- batch sizing
- retry delays / backoff

Implications:

- any queue-driven staging work must be idempotent
- acknowledge work at the smallest safe unit after durable persistence
- use DLQ/backoff for transient failures, not silent infinite retries
- staged build steps should avoid “retry whole batch and maybe duplicate state” patterns

### Workflows for durable orchestration

Relevant guidance:

- Workflows provide durable multi-step execution, retries, and state persistence without request timeouts

Implications:

- the correct-by-construction rebuild coordinator should likely be a Workflow, not a long single Worker request
- snapshot builds, verification, and publish gates fit the Workflow step model well
- long-running full rebuilds should not depend on one request surviving to completion

## Recommended implementation order

1. capture current baselines with characterization + invariant scripts
2. define published snapshot tables and version pointer model
3. implement staging build for one derived surface first (for example published topics)
4. prove incremental/full parity on that surface
5. migrate one route family to published tables
6. expand to similarity, summaries, and period metrics
7. remove route-level support fallbacks only after published snapshot reads are complete

## Related docs

- `docs/pipeline-architecture.md`
- `docs/architecture.md`
- `docs/lessons-learned.md`
- `docs/monthly-summaries-spec.md`
