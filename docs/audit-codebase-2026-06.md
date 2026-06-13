# Codebase and documentation audit — 2026-06-12

Full audit of the repository as of commit `c442c99` ("Stabilize production ingestion and alerting"). Four areas were reviewed: documentation accuracy, the ingestion/enrichment pipeline and data layer, the web layer and security posture, and tests/CI/configuration. Every high-severity finding below was verified directly against the cited source lines.

## Verified baseline

- `tsc --noEmit`: clean (exit 0).
- Workers Vitest suite: 102 files, 881 tests, all passing (~117s).
- Node Vitest suite: 6 files, 69 tests, all passing (~12s).
- No `describe.skip` / `it.skip` / `.only` / assertion-free tests anywhere in the repo.
- Playwright e2e was not executed (it targets the production deployment; see H1).

Overall verdict: the application logic is in good health — disciplined parameterized SQL, fail-closed admin auth, correct DST-aware cron gating, strong auditability — but the safety nets around it overstate what they protect (CI e2e is decorative, semantic-search paths are untested), and three real bugs sit on the unattended weekly refresh path.

---

## High severity

### H1. CI's e2e step cannot fail, cannot test the PR's code, and its mobile project cannot launch
- `.github/workflows/ci.yml:31-33` runs `npx playwright test` with `continue-on-error: true`, so any e2e failure leaves the job green.
- `playwright.config.ts:18-19` defaults `baseURL` to the production URL and defines no `webServer`; CI sets no `BASE_URL`. CI e2e therefore exercises the live deployment, not the code under review.
- `e2e/layout-grid.spec.ts:9-10` targets `/episodes/2026-05-12-rail-demo` and `/chunks/rail-demo-current-1`, which exist only after `npm run fixture:local`. Production returns 404 for both (verified), and the spec never asserts `response.status()`, so it silently audits the 404 page.
- `.github/workflows/ci.yml:29` installs only Chromium, but the `mobile` project (`playwright.config.ts:33-40`, iPhone 15) requires WebKit — every mobile e2e run fails at browser launch, invisibly.
- The "Upload Playwright report" step (`ci.yml:36`) is unreachable: `failure()` can never be true for the e2e step because of `continue-on-error`, and if an earlier step fails no report exists.

Fix: drop `continue-on-error`; run e2e against a seeded local server (fixture + `webServer` or `BASE_URL=http://localhost:9090`); install WebKit or remove the mobile project; then the report-upload condition becomes meaningful.

### H2. `enrichAllChunks` stops after two full batches and undercounts the second one — `src/jobs/ingest.ts:2368-2381`
The guard `if (result.chunksProcessed === lastProcessed) break;` is intended to detect chunks that can never enrich, but `processChunkBatch` always marks its chunks enriched (or throws), so a repeated count can't mean "stuck". What it actually detects is two consecutive full batches — the normal case whenever pending > 2×batchSize. With 600 pending chunks and the refresh batch size of 200, the loop processes 200 + 200 and exits with most of its 120s budget unused. The break also occurs before `total += ...`, so the second batch is processed in the DB but missing from `RefreshEvent.enriched_chunks` and pipeline metrics. Any large backlog (new archive source, `CURRENT_ENRICHMENT_VERSION` bump — the file documents six) converges at ≤2 batches per weekly cron, contradicting the function's own "loops internally" contract. The only covering test (`finalization.test.ts:174-192`) uses 4 chunks and never reaches a second full batch.

Fix: track cumulative pending count (or compare the actual chunk-id set), and accumulate `total` before evaluating the guard.

### H3. A duplicate episode date inside one source doc permanently breaks that source's refresh — `src/jobs/ingest.ts:532-542`
`ingestEpisodesOnly` dedups against `existingDates` loaded once (line 532) and never adds newly inserted dates inside the loop; `parseHtmlDocument` doesn't dedup by date either. Two `<h1>` headings with the same date both pass the check and both produce slug `${formatDate}-${sourceTag}` (line 536), so the second INSERT violates `episodes.slug UNIQUE` (migrations/0001) and throws. Episodes inserted before the duplicate are now in the DB, so every subsequent weekly run fails at the same heading — a permanent, author-content-triggered failure on the unattended cron path (`refresh.ts:206-214` marks the source failed; there is no skip/recovery). `/api/ingest` shares the hole.

Fix: add each inserted date to the set (or dedup parsed episodes by date before insert) and treat a duplicate as skip-with-log, not failure.

### H4. Queue idempotency keys are permanent and ignore the enrichment version — `src/jobs/queue-handler.ts:60-83`
`beginQueueJob` skips any job whose `queue_message_state` row says `completed`, and nothing ever deletes or expires those rows. Keys are content-derived (`enrich-batch:<sorted chunkIds>`, `assign-ngram:<phrase>`) with no version component. After a `CURRENT_ENRICHMENT_VERSION` bump, `/api/enrich-parallel` (`src/routes/api.tsx:499-521`) re-derives the same deterministic batches (`ORDER BY id DESC LIMIT 5000`, same slicing) — each one matches a previously completed key and is silently skipped (`skipped_completed`), stranding chunks at the old version. The table also grows without bound.

Fix: include the enrichment version in `enrich-batch` keys (and corpus state in `assign-ngram` keys), or add a TTL/cleanup for completed rows.

### H5. Nothing typechecks the repo — in CI or anywhere else
No `typecheck`/`lint` script exists in `package.json`, CI never runs `tsc`, and Vitest transpiles without checking types. `tsconfig.json` includes only `src/**`, `test/**`, and `.d.ts` files, so `scripts/` (10+ TS files) and `e2e/` are typechecked by nothing, ever. The check passes today (verified), so adding `"typecheck": "tsc --noEmit"` plus a CI step is a free win; extending coverage to `scripts/` and `e2e/` is a follow-up.

---

## Medium severity

### Security and web layer

**M1. Stored link `href`s have no URL-scheme allowlist (stored XSS via trusted doc).** `src/components/RichContent.tsx:15` renders `<a href={node.href}>`; the value comes from `src/services/html-parser.ts:240` via `resolveGoogleRedirectUrl` (`src/lib/html.ts:17-29`), which decodes entities and unwraps `google.com/url?q=` but validates no scheme. A `javascript:` URL in a trusted source doc (directly or wrapped in a Google redirect) becomes a live clickable script link on every chunk/episode page, and also feeds the episode External Links list (`src/routes/episodes.tsx:391`). Precondition is edit access to a registry doc, so this is stored-XSS-via-trusted-content, not anonymous-remote. Fix: allowlist `http:`/`https:`/`mailto:`/relative at ingest.

**M2. No security response headers.** The only header middleware (`src/index.tsx:25-33`) sets `Cache-Control`. No CSP, no `X-Content-Type-Options: nosniff`, no `X-Frame-Options`/`frame-ancestors`. A `script-src 'self'` CSP would backstop M1 and the two `dangerouslySetInnerHTML` sinks.

**M3. `/api/search` has no rate limit and no length cap.** `src/routes/api.tsx:139-175` runs FTS + topic boost for any query of any length, while the HTML route enforces a 200-char cap and a 60/min/IP D1-backed limit (`src/routes/search.tsx:27-68`). No Workers AI cost exposure (vector search lives only in the HTML route), but it is an unthrottled D1 CPU amplification vector. Apply the same gate.

**M4. The native rate-limiter binding exists only in code.** `SEARCH_RATE_LIMIT` is declared in `src/types.ts:7` and used at `src/routes/search.tsx:32-33`, but appears in no wrangler config — the branch is dead in every environment including production, which silently falls back to the D1 counter. Either bind it or remove the branch. (`docs/lessons-learned.md` warns about exactly this class of drift.)

### Pipeline and data layer

**M5. Queue-path enrichment hardcodes the extractor mode.** `src/jobs/queue-handler.ts:229` calls `processChunkBatch(db, chunkRows, "naive", ...)`, ignoring `env.TOPIC_EXTRACTOR_MODE`, while cron and `/api/enrich` normalize the env var (`refresh.ts:220`, `api.tsx:457`). Harmless today (prod var is `naive`); the day the mode changes, `/api/enrich-parallel` chunks silently diverge from the rest of the corpus.

**M6. Ingest-path embeddings are unbatched.** `src/jobs/ingest.ts:2433-2444` embeds and upserts all inserted chunks in single calls; `/api/embed` clamps to 100 (`api.tsx:410`) because Workers AI / Vectorize have per-request limits. Oversized ingests throw inside the catch-and-continue block, so embeddings and `chunk_vector_cache` rows are silently missing for exactly the largest ingests.

**M7. Optional LLM enrichment failure fails the whole source refresh.** `src/jobs/refresh.ts:161-164` doesn't wrap `llmEnricher` (embeddings are wrapped); a transient AI error after episodes are inserted marks the source failed and increments `consecutive_failures`. The LLM candidates are never retried automatically — recovery requires knowing to call `/api/backfill-llm`.

**M8. A dead queue subsystem misleads operators.** The `compute-related`, `extract-ngrams`, and `assign-ngram` handlers (`src/jobs/queue-handler.ts:102-211`) have no producers anywhere in src/; `finalizeEnrichment(db, queue?)` ignores its `queue` parameter (`ingest.ts:1675`), so `FinalizeResult.ngram_dispatched` is always false and `related_slugs_method: "queue"` is unreachable. Related: `extractPMIPhrases` (`src/services/pmi-phrases.ts:18-39`) is an O(words²)-per-chunk self-join that would hit D1 scan limits at corpus scale, and its output is two co-occurring (not adjacent) words matched back with unescaped `LIKE '%phrase%'` — currently defused only by having no producer. Either wire the subsystem up deliberately or delete it.

**M9. `similarity_cluster` can merge topics in cycles.** `src/jobs/ingest.ts:1984-2018` iterates a topic list loaded once; merged-away topics remain in memory with stale usage counts, and Dice similarity is symmetric, so A→B then B→A merges are possible, parking links on a hidden topic and writing circular `topic_merge_audit` chains. Later finalize steps usually self-heal it, but each `runStep` swallows errors, so an abort between steps leaves links on invisible topics until the next successful finalize.

**M10. `/api/ingest` can bypass the trusted-source registry for already-present rows.** `src/routes/api.tsx:193-199` checks `describeSource(docId)` only when the doc isn't already in `sources`; a row that predates the registry lock (or was de-listed later) remains fetchable. The cron path and `/api/backfill-source` check the registry strictly; this is the one inconsistent path. Admin auth mitigates.

**M11. Entity alias expansion matches substrings.** `src/lib/entity-aliases.ts:20` uses `lower.includes(name)`: a search for "john" matches alias `hn` and expands to Hacker News terms; "metadata" triggers Meta. A word-boundary helper already exists (`topic-extractor.ts:159-162`).

**M12. Finalize is an N+1 subrequest farm on the weekly hot path.** `phrase_lexicon_backfill` issues ~5 queries per lexicon phrase (cap 200 → ~1000 queries) and `entity_validation` ≥2 per entity (`src/jobs/ingest.ts:1695-1795, 2103-2149`), approaching the Workers ~1000-subrequest cap as the corpus grows. Single-statement equivalents already exist in `src/db/corpus-maintenance.ts:27-69` but the finalize path doesn't use them.

**M13. `word_stats` lost all constraints in migration 0007.** `CREATE TABLE word_stats AS SELECT * FROM concordance` (`migrations/0007_topics_rename.sql:34`) drops PK/NOT NULL/defaults; rebuilt rows get `id = NULL` while `WordStatsRow.id` is typed `number` (`src/types.ts:95`). Nothing reads `id` today — latent schema debt guarded only by the 0011 unique index.

### Tests, CI, config

**M14. The Workers test config omits half the production bindings.** `wrangler.test.jsonc` has only D1 + one var. With no `AI`/`VECTORIZE`, every `if (env.AI && env.VECTORIZE)` path — semantic search (`src/routes/search.tsx:116-130`), embedding upsert, vector cross-refs — never executes under test; only the FTS fallback is covered. Queue consumer semantics (batching, retries, DLQ) are likewise untested (handlers are called directly with fake batches). Related bug: `src/routes/api.tsx:520` does an unguarded `c.env.ENRICHMENT_QUEUE.send(...)` (contrast the guarded path at `api.tsx:388`) — in any binding-less environment that route 500s.

**M15. Two test files run under both Vitest configs.** `vitest.config.ts` uses the default include and its exclude list omits `scripts/**` and `src/services/html-parser.property.test.ts`, both of which `vitest.node.config.ts` also includes — so `scripts/pipeline-tooling.test.ts` and the heavy fast-check property suite (multi-MB `?raw` corpus imports) run twice per CI pass. Their four siblings are correctly excluded; these look like missed entries.

**M16. The test migration list is a hand-maintained mirror.** `test/helpers/migrations.ts:1-25,107-133` imports all 25 migrations explicitly (verified complete and ordered today), but a future `0026_*.sql` is silently invisible to tests — exactly the drift the README's "real migration files" claim is about. `@cloudflare/vitest-pool-workers` exports `readD1Migrations` to derive this from the directory. The custom `splitSqlStatements` trigger detection (`/^END;$/`) is also fragile.

**M17. `tsx` is invoked but not a dependency.** `package.json:12,13,18` run `npx tsx ...` for `fixture:local`, `maintenance:remote`, and `health:production`, but `tsx` is in neither devDependencies nor the lockfile — first run fetches an unpinned latest from the registry and fails offline.

**M18. `.gitignore` misses `.rollback-bundles/`.** `npm run snapshot:rollback` writes full production table dumps plus `restore.sh` into the repo root (`scripts/export-rollback-bundle.mjs:12`); one careless `git add -A` commits production data.

### Documentation

**M19. CHANGELOG.md is five weeks stale.** Last entry 2026-04-30; eight commits since (registry locking, corpus repair, refresh hardening, London cron scheduling, archive-source caching/health checks, LICENSE, production alerting) are unlogged.

**M20. `docs/architecture.md:141` documents the wrong cron day.** It shows `0 8 * * 3` / `0 9 * * 3` (Wednesday); `wrangler.jsonc:31` deploys `* * 2` (Tuesday), and the doc's own prose says Tuesday. Dangerous combination with the runtime gate: if someone "fixed" the config to match the doc, `isTuesdayNineAmLondon` would never pass and the weekly refresh would silently stop (only a `refresh_skip` log line).

**M21. TODO.md's first product item appears already shipped.** "Deploy the current shared-surface UI to live so `/design` … match local" — `/design` is registered (`src/index.tsx:42`), fully implemented, and described as expanded in the 2026-04-24 changelog entry; TODO.md was last touched after that.

---

## Low severity (notable)

Security/web:
- Admin secret comparison is not constant-time (`src/routes/api.tsx:133`); secret otherwise well-handled (header-only, never logged, fails closed when unset).
- FTS5 grammar pass-through: queries containing `OR` are injected raw into MATCH (`src/services/search.ts:73`); bounded by catch-and-fallback to `keywordSearch`. The purpose-built `sanitizeFtsQuery` (`src/lib/html.ts:58-61`) is dead code — only its test references it.
- Authenticated 500s leak `e.message`/`e.stack` excerpts (`api.tsx:333,355,401,594,631-634`); admin-only audience.
- `wrangler.local.jsonc:15` commits `ADMIN_SECRET: "local-secret"` (local-only risk); Cloudflare account/database IDs committed in configs and two scripts (identifiers, not secrets, but now public).
- All mutating admin endpoints are GETs, including `purge-source`; not CSRF-able (Bearer header, no cookies) but a design smell. The global cache middleware stamps `public, s-maxage=3600` on all 2xx HTML — fine today, a trap for any future authenticated HTML page.
- `escapeLike` (`src/lib/html.ts:50-52`) doesn't escape the escape character itself; `handleAssignNgram` and finalize's phrase backfill bind unescaped `%${phrase}%` patterns (`queue-handler.ts:153-155`, `ingest.ts:1744`).

Pipeline/data:
- `queue-handler.ts:188-191` paginates with LIMIT/OFFSET and no ORDER BY (can skip/duplicate rows); `/api/embed` does it correctly.
- `/api/cleanup-stale` uses `DELETE ... LIMIT` (`api.tsx:578-582`), which requires a non-default SQLite build flag; the finalize path deliberately uses the portable `WHERE id IN (SELECT ... LIMIT)` form. Endpoint has zero test coverage.
- `shouldRetryQueueMessage` substring-matches "429"/"503"/"504" anywhere in the error string (an error mentioning "chunk 5036" retries as transient); non-retryable failures are acked, so they never reach the configured DLQ — the DLQ receives only exhausted retries.
- Metric lies: `chunk_links_inserted` and `chunk_topic_links_inserted` count attempted statements, not actual `INSERT OR IGNORE` insertions (`queue-handler.ts:167`, `ingest.ts:1206`).
- Write-only storage: `source_html_chunks` / `episode_artifact_chunks` are rewritten every refresh but read by no production code; `episodes.content_markdown/rich_content_json/links_json` are always written NULL; `episodes.summary`/`chunks.summary` never written but still rendered.
- Heading-id regex bug: `` `>\s*<span` `` inside a template literal collapses `\s` to a literal `s` (`src/services/html-parser.ts:491`); harmless only because `headingId` is never persisted.
- ~17 dead exports across db/services/lib (full list available via grep of non-test importers), including `getDisplaySuppressionReason` — a drifted duplicate of the live display rules — and the entire recount family duplicated between `ingest.ts:1355-1497` and `corpus-maintenance.ts:27-111`.
- `src/jobs/ingest.ts` is 2,463 lines — 14% of all non-test source in one file; it contains phase-1 ingest, enrichment, 18-step finalization, merging, and recounts. Splitting it would shrink most future diffs.

Tests/CI/config/docs:
- CI actions pinned to major tags only; no `engines`/`.nvmrc`; `@types/node` v25 against Node 22 runtime.
- CI inlines `npx vitest run --config vitest.node.config.ts` instead of `npm run test:real`, so script edits won't propagate.
- `worker-configuration.d.ts` is stale (missing the `AI_GATEWAY_ID` var); harmless because the app uses hand-rolled `src/types.ts`, but `npm run types` is in no workflow.
- `wrangler.jsonc` carries the production `database_id` with no `preview_database_id`; several ops scripts default to this config, one `--remote` flag away from production.
- Orphan scripts with no entry point from package.json or docs: `clone-live-topic-preview.mjs`, `compute-distinctiveness.ts`, `embed-missing-vectorize.mjs`, `local-ingest.ts`, `reindex-vectorize-metadata.mjs`, `repair-corpus-derived.ts`, `run-refresh.sh` — two of them touched in the latest commit.
- `package-lock.json` root metadata predates the MIT `license` field added to package.json in `28b7349`; any `npm install` dirties the tree until the lockfile is regenerated.
- ~25MB of raw third-party Google Docs HTML committed under `data/raw/` (needed by the node suite via `?raw` imports): clone weight plus a content-licensing/PII consideration — this republishes the author's full corpus in a public MIT-licensed repo.
- README's search-operator table omits the implemented `topic:` operator; `docs/production-alerts.md` and `docs/queue-dlq-replay.md` (current operational docs) are linked from nowhere.
- Visual e2e asserts `answer.includes("yes")` on free-form LLM output — "NO, but yes…" passes (opt-in suite only).

---

## What is done notably well

- **D1 binding-limit discipline.** `src/lib/db.ts` (`MAX_SQL_BINDINGS = 90`, `chunkForSqlBindings`, `collectInBatches`, `sqlPlaceholders`) is used consistently for every dynamic IN-list and bulk insert, with a dedicated regression test; `search-topics.ts` sidesteps the problem entirely with `json_each(?)`. No unbounded bind list was found anywhere.
- **Uniform, fail-closed admin auth.** All 12 state-changing/paid endpoints share one `requireAuth` gate that 401s when `ADMIN_SECRET` is unset; the secret travels only in the Authorization header and is never logged or echoed.
- **Parameterized SQL throughout.** No user data is ever interpolated into SQL; LIKE inputs are escaped at the public call sites; the JSON-LD sink and both highlight sinks escape correctly; client JS uses `textContent`/`encodeURIComponent`.
- **SSRF containment.** Outbound fetch is double-gated by admin auth and the checked-in trusted-source registry; doc IDs are regex-constrained; the cron path filters sources to trusted IDs in SQL.
- **Timezone/cron correctness.** Dual UTC crons plus the `Intl`-based Europe/London gate fire exactly once year-round (UK DST shifts on Sundays, so the Tuesday gate has no edge cases), with tests covering both DST directions.
- **Auditability.** Per-candidate topic decision trails, merge lineage with compaction, per-stage pipeline metrics, a cost-event ledger for every AI/Vectorize call, structured JSON logs, crash recovery for interrupted runs, and an invariant audit/repair pair wired into the API. Zero TODO/FIXME/`@ts-ignore` in the data layer.

## Suggested fix order

1. CI: remove `continue-on-error`, point e2e at a seeded local server, install WebKit or drop the mobile project (H1); add `tsc --noEmit` to package.json and CI (H5).
2. Refresh-path bugs: H2 (loop guard), H3 (date dedup), M7 (wrap LLM enrichment) — these are the unattended-cron failure modes.
3. H4 + M5 together (version-aware queue keys, env-driven extractor mode) before the next enrichment-version bump.
4. Security hardening batch: M1 (href scheme allowlist), M2 (headers), M3 (`/api/search` gate), M4 (bind or remove `SEARCH_RATE_LIMIT`).
5. Config/test hygiene: M14-M18 (test bindings, double-run suites, derived migration list, `tsx` dependency, `.gitignore`).
6. Docs: M19-M21 plus the architecture.md cron-day fix (one character, prevents a silent-refresh-stop trap).
7. Dead-code sweep (M8, dead exports, write-only tables) and the `ingest.ts` split, opportunistically.
