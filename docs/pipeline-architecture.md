# Pipeline Architecture

## Purpose

Bobbin has two distinct pipeline goals:

1. preserve the Google Docs source faithfully enough to render useful chunk and episode pages
2. build a deterministic topic pipeline that can be rerun cheaply without reinvoking the LLM

The pipeline is deliberately split so the expensive semantic step happens once per episode at ingest time, while the downstream topic pipeline remains reproducible and cheap to rerun.

Operational note:

- test bootstrap and local pipeline bootstrap both apply the checked-in D1 migration chain directly, so schema behavior matches the real app path instead of a separate handwritten test schema.
- refresh now iterates all configured non-empty sources in `sources`, rather than hardcoding a single current-doc ID.

## End-to-end flow

```text
Google Docs mobilebasic HTML
  -> fetchGoogleDoc()
  -> persistSourceHtmlChunks()
  -> parseHtmlDocument()
  -> ingestEpisodesOnly()
     -> episodes
     -> chunks
     -> episode_artifact_chunks
     -> chunk rich-content fields
  -> enrichEpisodesWithLlm() for new/backfilled episodes only
     -> llm_enrichment_runs
     -> llm_episode_candidates
     -> llm_episode_candidate_evidence
  -> enrichChunks() / processChunkBatch()
     -> analysis_text
     -> chunk_words
     -> topic_candidate_audit
     -> topics / chunk_topics / episode_topics
  -> finalizeEnrichment()
     -> usage recounts
     -> word_stats rebuild
     -> phrase lexicon + merges + display decisions
```

## Stage 1: Fetch And Preserve Source

Entry point:

- `fetchGoogleDoc()`

Primary storage:

- `source_html_chunks`

What is preserved:

- raw source HTML exactly as fetched
- fetch timestamp

Why this exists:

- parser improvements must be able to replay the original source
- fidelity bugs can be repaired by reparsing and backfilling artifacts

## Stage 2: Parse HTML To Episodes And Chunks

Entry point:

- `parseHtmlDocument()` in `src/services/html-parser.ts`

Output model:

- `ParsedEpisode[]`
- each episode contains parsed chunks plus rich-content artifacts

Current parser responsibilities:

- split documents into episodes by date headings
- split notes/essay content into chunks using Google Docs list indentation structure
- preserve rich content blocks and inline spans
- preserve links with resolved URLs
- preserve nested list depth
- preserve images, superscript, strikethrough, separators, footnotes
- preserve inline fragment anchors used for cross-chunk references

Derived artifacts:

- `contentPlain`
- `contentMarkdown`
- `richContent`
- `links`
- `images`
- `footnotes`

Important invariant:

- source fidelity is derived from structured rich content, not from the normalized analysis text used downstream

## Stage 3: Phase-1 Ingest

Entry point:

- `ingestEpisodesOnly()` in `src/jobs/ingest.ts`

Writes:

- `episodes`
- `chunks`
- `episode_artifact_chunks`

What Phase 1 does:

- dedups by `published_date` per source
- inserts episodes and chunks
- stores chunk rich-content fields directly on `chunks`
- stores large episode artifacts in chunked side tables
- resolves non-footnote fragment links to real chunk URLs when the target anchor is known in the same ingested source

Important invariant:

- fragment links such as `#id...` are rewritten at ingest/backfill time to `/chunks/:slug#id...` only when a real target anchor exists

## Stage 4: Episode-Level LLM Enrichment

Entry points:

- `enrichEpisodesWithLlm()`
- `enrichEpisodeIdsWithLlm()`

Model:

- `@cf/google/gemma-4-26b-a4b-it`

Primary tables:

- `llm_enrichment_runs`
- `llm_episode_candidates`
- `llm_episode_candidate_evidence`

Input to the model:

- normalized episode text
- chunk slugs
- chunk titles
- short normalized excerpts
- fidelity hints such as links, nesting, formatting, images

Output contract:

- proposals only, never authoritative truth
- candidate name
- kind
- confidence
- rank position
- aliases
- evidence: `chunk_slug` and quote

Important invariant:

- the LLM runs once per episode ingest/backfill event
- downstream reruns do not need another LLM call

## Stage 5: Deterministic Chunk Enrichment

Entry point:

- `enrichChunks()`
- `processChunkBatch()`

Core steps:

1. normalize chunk text to `analysis_text`
2. rebuild phrase lexicon inputs
3. extract deterministic candidates
4. validate entity boundaries
5. apply corpus-prior rejection
6. combine deterministic candidates with bounded LLM/fidelity boosts
7. gate promotion deterministically
8. write `topic_candidate_audit`, `chunk_topics`, `episode_topics`, `chunk_words`

Primary tables touched:

- `chunks.analysis_text`
- `phrase_lexicon`
- `topic_candidate_audit`
- `topics`
- `chunk_topics`
- `episode_topics`
- `chunk_words`

Important invariant:

- LLM output can only boost or add candidates with real evidence; it does not bypass deterministic gating

## Stage 6: Finalization

Entry point:

- `finalizeEnrichment()`

Responsibilities:

- recount topic usage
- rebuild `word_stats`
- compute reach and distinctiveness
- validate entities and clean noise topics
- apply phrase/topic merges
- apply display suppression decisions
- archive lineage rows for removed topics

Operational characteristic:

- this is the corpus-wide cleanup and consolidation phase after chunk-level extraction

## Backfill And Repair Paths

Admin routes:

- `GET /api/purge-source?doc=...`
- `GET /api/backfill-source?doc=...&offset=...&limit=...&llm=0|1`
- `GET /api/backfill-llm?doc=...&limit=...`

Operational helper:

- `npm run maintenance:remote -- <command>` with `BASE_URL` and `ADMIN_SECRET`

Use `backfill-source` when you need to repair:

- source fidelity artifacts
- rich-content rendering bugs
- fragment-link resolution
- episode/chunk artifact storage derived from parser changes

Use `backfill-llm` when you need to populate missing episode-level LLM proposal caches without reparsing source fidelity.

Use `purge-source` when provenance audit shows a doc should never have been admitted to the corpus and you need to delete the source row plus its dependent episodes, chunks, logs, and source artifacts.

## Queue And Async Work

Queue:

- `bobbin-enrichment`

Used for:

- enrichment batch work
- slow background steps
- queued LLM episode backfill when available

Important note:

- the queue improves throughput but does not change the storage contract or deterministic downstream rules

## Storage Summary

Core source preservation:

- `source_html_chunks`
- `episodes`
- `chunks`
- `episode_artifact_chunks`

LLM cache:

- `llm_enrichment_runs`
- `llm_episode_candidates`
- `llm_episode_candidate_evidence`

Deterministic topic pipeline:

- `phrase_lexicon`
- `topic_candidate_audit`
- `topics`
- `chunk_topics`
- `episode_topics`
- `chunk_words`
- `word_stats`
- `topic_lineage_archive`

## Operational Invariants

- raw HTML is the canonical recovery source
- rich source fidelity and normalized analysis text are separate concerns
- episode-level LLM enrichment is cached and bounded
- downstream topic promotion remains deterministic
- backfill can repair stored artifacts without changing the raw source
- non-footnote fragment links should resolve to real chunk URLs only when a preserved target anchor exists

## Related Docs

- `docs/source-fidelity-plan.md`
- `docs/llm-ingest-plan.md`
- `docs/yaket-bobbin-tuning.md`
- `docs/architecture.md`
- `docs/correct-by-construction-pipeline-spec.md`
