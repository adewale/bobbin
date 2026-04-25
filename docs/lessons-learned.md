# Lessons Learned: Building Bobbin

## What happened

We built Bobbin — a searchable archive of Alex Komoroske's "Bits and Bobs" newsletter — on Cloudflare's platform (Workers, D1, Vectorize, Workers AI) in a single session. Seven commits tell the story:

1. **9a40f60** — Built the entire app in one shot (6,706 lines, 59 files)
2. **2209a3b** — Added FTS5 search, diff view, RSS, reactive concordance
3. **dc23d2b** — First chunking fix (wrong: used `lst-kix` list IDs)
4. **44fe2a7** — Fixed archive ingestion (401s on private docs)
5. **818f538** — Added semantic cross-references and embeddings
6. **f4dbe36** — Fixed ALL the quality problems we should have caught earlier

The last commit is the most telling. It fixes: bad chunking, bad tags, bad titles, noisy concordance, useless search results, and generic visual design. All problems that existed from commit 1 but weren't caught until we actually looked at the live site with real data.

## What went wrong with the spec

**The spec was a wish list, not a spec.** It listed features ("Offer a timeline UI", "Expose a search interface") without defining what good looks like. There were no acceptance criteria, no examples of expected output, no definition of an observation vs a chunk, no sample data.

**We never looked at the actual content before designing the system.** The spec said "Grab all of the content from [Google Doc]" but we didn't look at the Google Doc's structure until we had already written a parser, a database schema, and 14 routes. When we finally did look, the parser was wrong three times:

1. First parser: designed for Google Docs API JSON (couldn't access the API)
2. Second parser: split on `padding-top:12pt` (produced ~400 chunks per episode)
3. Third parser: split on `lst-kix_*-0 start` (produced ~1 chunk per episode)
4. Fourth parser: split on `margin-left:36pt` (finally correct: ~4-8 per episode)

Each iteration required re-ingesting the entire corpus.

**The spec assumed auth would be simple.** "Grab all of the content" glossed over the fact that the Google Doc required authentication. We built a full JWT/service account system, then discovered the `/mobilebasic` URL works without auth. Then discovered archive docs return 401 even on that URL. Three iterations of auth strategy.

## What went wrong with the process

**We built too much before validating.** Commit 1 was 6,706 lines. It included a complete SSR app with 14 routes, 8 components, 7 services, and 92 tests — all before we had any real data flowing through the system. The TDD was real (red-green on every component) but the tests validated code behavior, not user experience.

**We tested the code, not the product.** "GET / returns 200 with HTML containing `<title>`" passed from the first test run. But the actual page showed "1 chunks" and tags like "it's" and "everyone". The tests were green while the experience was bad.

**We didn't dogfood.** Nobody looked at the live site until asked "Is this a good experience?" The answer was no, and the reasons were all things visible at a glance: one giant chunk per episode, stopwords as tags, no context in search results.

**Ingestion performance was an afterthought.** Each chunk required 10+ individual D1 writes (chunk insert, 5 tag inserts, 5 chunk_tag inserts, concordance words). With 400 chunks per episode, ingestion timed out on every request. Batching should have been the default from the start.

## What would have made things better

### 1. Start with the data, not the architecture

Before writing a single line of code, we should have:
- Fetched the Google Doc HTML
- Counted the episodes and observations manually
- Defined what a "chunk" is with 3 concrete examples
- Verified which URLs work without auth

This would have saved 3 parser rewrites and the entire google-auth.ts detour.

### 2. Write acceptance tests, not unit tests

Instead of "GET / returns 200", the first test should have been:

```
Given a Google Doc with 3 episodes of 5 observations each,
when I visit the homepage,
I see 3 episode cards,
each showing 5 chunk titles that are readable topic labels,
and the tags are domain-specific words like "ecosystem" not "people".
```

This kind of test would have caught the chunking and tag quality problems immediately.

### 3. Deploy and look at it after every feature

Commit 1 should have been: scaffold + ingest 1 episode + render it. Look at it. Is the chunking right? Are the titles readable? Only then build the next feature.

### 4. Define "done" for each feature

"Expose a search interface" is not a feature spec. "Search for 'ecosystem' and get the 5 most relevant observations, with the matching text highlighted in context" is.

## Which tools would have helped

### Content-first prototyping
A tool that fetches a live data source and shows you what your parser produces *before* you build the rest of the app. Something like: `npx bobbin-preview https://docs.google.com/...` that outputs the parsed episodes and chunks as a table so you can visually verify the chunking.

### Visual regression testing
Playwright or similar to take screenshots of rendered pages and compare against expectations. Would have caught the "1 chunks" and HTML entity problems.

### Schema-first design with sample data
A tool that generates realistic test fixtures from a data schema. Instead of hand-writing `sample-doc.json` and `sample-mobilebasic.html`, we should have fetched a real small sample from the live doc and used that as the fixture from day one.

### Property-based testing for data quality
We added property tests for the search merge/rerank function (which was great). We should have also added property tests for:
- "Every tag name is a real English word with no HTML entities"
- "Every chunk title is between 10 and 80 characters"  
- "Every episode has between 1 and 20 chunks"
- "No two chunks in the same episode have the same title"

These invariants would have caught the quality issues at the test level.

### Live preview during development
`wrangler dev` worked but we rarely checked it. An auto-opening browser tab after each deploy, or a split-pane terminal showing the rendered HTML, would have made the quality problems impossible to ignore.

## The meta-lesson

**TDD validates code correctness but not product quality.** You can have 122 passing tests and a bad product. The gap between "the code works" and "this is good" is where most of the actual work lives. Looking at the live site with real data — and being honest about what you see — is the most valuable test of all.

## What the test audit revealed

After building the app with 122 unit and route tests, a deep audit found:

**50% of source files had zero test coverage.** All 8 JSX components, most routes' rendering logic, and all external-dependency services (embeddings, summarizer, Google Docs) were untested.

**The tests that existed tested the wrong things.** Checking `expect(html).toContain("Nanotech cages")` passes whether the HTML is well-formed or broken — it's a string-in-string check, not a behavior check. Checking `GET / returns 200` passes even when the page shows "1 chunks" and tags like "it's".

**Property-based testing caught a real bug on the first run.** The PBT for `stripToPlainText` found that angle brackets in content text (not tags) weren't handled — counterexample: `">"`. This is exactly the kind of edge case example-based tests miss because humans write the examples they already thought of.

**The audit identified 47 testable invariants** across 10 modules. The most valuable:
- `slugify` is idempotent and output always matches `/^[a-z0-9-]*$/`
- `tokenize` output never contains stopwords and always > 3 chars
- `extractTags` never returns HTML entities and never exceeds maxTags
- `mergeAndRerank` output is always sorted descending with no duplicates
- Every chunk belongs to a valid episode; positions are sequential
- Concordance word counts match chunk_words aggregates

### Three types of tests that were missing

1. **Property-based tests** — invariants that hold for ALL inputs, not just the 3 examples you thought of. Fast-check found edge cases in the first run that 122 example tests missed.

2. **Data consistency tests** — after ingestion, do the foreign keys actually reference valid rows? Does `episode.chunk_count` match the real count? These are database-level invariants that unit tests don't cover.

3. **End-to-end pipeline tests** — parse HTML → ingest to D1 → query via route → render HTML. The unit tests for each step passed, but the pipeline had integration bugs (wrong chunk counts, broken slugs) that only showed up when the pieces connected.

### What we learned about PBT

**PBT is most valuable for functions with clear contracts.** `slugify`, `tokenize`, `extractTags`, and `mergeAndRerank` all have simple contracts (output format, invariants, bounds) that are easy to express as properties but tedious to test exhaustively with examples.

**PBT is less valuable for I/O-heavy code.** You can't meaningfully fuzz a Google Docs fetch or a D1 query. For those, integration tests with realistic fixtures are better.

**PBT finds the bugs you wouldn't write tests for.** Nobody writes a test for "what if the input to slugify is a string of emoji?" But fast-check will generate that input, and if your function can't handle it, you'll know.

### The complete lesson list

1. Start with the data, not the architecture
2. Write acceptance tests with concrete examples of expected output
3. Look at the live product after every feature, not just at the end
4. Define "done" with specific criteria, not vague feature names
5. PBT catches edge cases that example tests miss — use it for functions with clear contracts
6. Data consistency tests catch integration bugs that unit tests miss
7. End-to-end pipeline tests are more valuable than component tests in isolation
8. The spec should include sample data and expected outputs, not just feature wishes
9. Auth strategy should be validated before any code is written
10. Ingestion performance should be designed for, not patched after the fact
11. TDD validates correctness, not quality — you need both
12. A test suite that reports 100% green can still describe a bad product

## What we learned in the topics migration

The move from tags to topics was the largest refactoring since the initial build. It touched the database schema, the extraction pipeline, the display layer, and the search system. Here is what it taught us.

### Taxonomy matters

Calling everything "concept" led to 2,241 misclassified proper nouns. People, companies, and products were all `kind='concept'` in the database, which meant the entity validation step in finalization skipped them entirely. Adding a `kind` column with values `concept`, `entity`, and `phrase` was the single most impactful schema change. It enabled entity-specific validation, phrase subsumption logic, and better ranking on the topics grid.

### Noise filtering: display time vs insert time

The original design filtered noise words at display time across three query files. This meant garbage topics were stored, had `usage_count` computed, had `related_slugs` computed, and had `reach` contributions calculated — all wasted work for topics that would never be shown. Moving the `isNoiseTopic` check to insert time in `enrichChunks` prevented the waste from accumulating. Keep the display-time filter as a safety net, but the primary gate should be at insertion.

### IDF was dead code for weeks

`extractTopics` accepted an optional `corpusStats` parameter, but `enrichChunks` never passed it. All TF-IDF scoring silently fell back to pure TF (no IDF). Nobody noticed because there were no tests that verified the IDF path was active during actual ingestion. The fix was straightforward — compute corpus stats before enrichment and pass them in — but the lesson is: if a function has an optional parameter that changes behavior, test both paths.

### Entity detection via curated list + heuristics is good enough

The three-layer entity detection system (curated known-entities list, heuristic capitalization detection, TF-IDF keywords) produces zero false positives and near-perfect recall for curated entities. AI-based entity extraction would be nice-to-have for discovering new entities, but the deterministic approach is predictable, testable, and free.

### N-gram extraction needs to run at corpus level, not per-chunk

Per-chunk bigram extraction fails because chunks are too short (50-500 words) for any bigram to appear multiple times. The corpus-level approach discovers phrases like "prompt injection" (81 chunks), "vibe coding" (37), and "cognitive labor" (35) that span the corpus. This is one of those cases where the "obvious" approach (extract per-document) is wrong and the batch approach (extract across the corpus) is right.

### Queue-based parallelization turned a 5-minute timeout into a 15-second operation

Computing `related_slugs` for 6,000 topics requires 6,000 individual queries. Running them serially timed out. Dispatching them to the `bobbin-enrichment` queue with 10 concurrent consumers brought the wall clock time to roughly 6 seconds. The same pattern works for n-gram chunk assignment. The queue is free tier (under 10K ops/day) and the fallback to serial inline processing still works for tests and dev.

### Wide event logging should be there from day 1

The canonical log line pattern (one structured JSON object per cron run with per-step timing) was added retroactively. Before that, debugging production failures meant grep-ing through scattered `console.log` calls. The `RefreshEvent` type in `refresh.ts` and the `queue_batch` log in `index.tsx` now make it possible to see at a glance what happened, how long each step took, and where it failed.

### Pipeline order matters

Extracting topics before computing word stats meant IDF was unavailable during topic extraction. Discovering n-grams after per-chunk extraction meant phrase topics were only created during finalization, not during the main enrichment pass. The correct order is: build word_stats first, extract corpus n-grams, then run per-chunk topic extraction with both IDF and known phrases available.

### The enrichment script is essential

`scripts/run-enrichment.sh` wraps the manual admin API calls (ingest, enrich, finalize) into a single script. Without it, re-enriching the corpus after a pipeline change required remembering the correct sequence and curl commands. Operational tooling is not optional.

### Dead code removal is healthy

Going from 507 tests to 496 tests after removing dead code (ThemeRiver, tag-generator, concordance routes, RSS feeds, sitemap, timeline, reading mode) is a sign the codebase is getting cleaner, not worse. Tests for dead code should be removed with the code they test.

## What we learned in the YAKE migration and finalization fix

The move from TF-IDF to YAKE keyword extraction and the finalization reliability work taught us the most about D1 at scale and about the difference between algorithms that work on small data and algorithms that work on real data.

### TF-IDF was the wrong algorithm

TF-IDF was designed for document retrieval (which documents match a query?), not topic extraction (what are the key concepts?). With short texts (50-200 words per chunk), TF-IDF can't distinguish domain terms from random English words. It produced 12,000+ topics from 5,700 chunks — most of them garbage like "emergent", "resonant", "moment". YAKE (Campos et al., 2020) uses within-document features (position, casing, frequency, context) and naturally produces multi-word keyphrases. Switching from TF-IDF to a pure TypeScript YAKE implementation, combined with a df≥5 quality gate, reduced active topics from 12,000 to 531. The top topics are now actual newsletter concepts: "Claude Code", "coasian floor", "gilded turd", "hyper era".

### The noise word list doesn't scale

We went through four rounds of expanding the NOISE_WORDS set (from ~90 to ~250+ words). Each round caught the current batch of garbage but new garbage appeared. The fundamental issue: any word list is finite but English is not. The structural fixes that actually worked were: (1) YAKE instead of TF-IDF, (2) the df≥5 corpus-wide quality gate, (3) suffix heuristics for verb/adjective patterns (-ly, -ize, -ment), and (4) multi-word phrase filtering for generic pronoun starters ("everyone", "someone"). The noise list is a safety net, not the primary filter.

### Finalization must be resilient, not atomic

The original `finalizeEnrichment` threw on the first error, losing all progress. With 18 steps, any one failure meant "Finalization failed" with no information about which step failed or what succeeded. Making `runStep` non-throwing (continue on error, return partial results) was the single most important observability change. It turned an opaque failure into: "14 steps OK, step 6 failed with D1 CPU limit, steps 7-18 continued and succeeded."

### D1 has per-query CPU limits, not just request timeouts

The Workers timeout (30s) is separate from D1's per-query CPU limit. A single correlated UPDATE across 13,000 topics can exceed D1's CPU budget even if the Workers request has time remaining. The fix: batch every correlated UPDATE by actual row IDs. We also learned that batching by ID range (0-1000, 1000-2000...) is a trap when the ID space is sparse — if MAX(id)=434K but only 500 rows exist, you run 434 empty queries. Always fetch actual IDs first, then batch by those.

### Re-enrichment must delete before inserting

`processChunkBatch` originally did INSERT OR IGNORE for chunk_topics, which meant re-enrichment accumulated old links alongside new ones. When we changed the extraction algorithm (TF-IDF → YAKE), the old chunk_topics from TF-IDF kept 400K dead topics alive because they still had links. The fix: DELETE old chunk_topics for the batch before inserting new ones. Clean slate on re-enrichment.

### Orphan accumulation is the production-scale failure mode

With a small test corpus (4-10 chunks), topics table stays small. At production scale (5,700 chunks × 4 enrichment versions), the topics table grew to 434K rows. Each enrichment version created new topic rows (INSERT OR IGNORE), but old rows were never deleted. The orphan deletion step must be aggressive: delete all topics with zero chunk_topics links, and run it before expensive operations (usage recount, distinctiveness) so those operations process a small table.

### Test locally with 1 and 10 episodes before deploying

We deployed 8 times before learning this lesson. The local pipeline script (`scripts/local-pipeline.ts`) runs the full ingest → enrich → finalize loop in under 10 seconds against real data. The apostrophe bug was found and fixed locally in 2 minutes; without local testing, it took 3 deploy cycles. The `scripts/analyze-topics.ts` corpus analysis tool was equally valuable — it showed us exactly what topics each parameter change produced.

### The right number of topics follows Heap's law

For a corpus of N documents, Heap's law predicts sqrt(N) to N^0.4 navigational topics. For N=5,700 chunks, that's 75-250. Our final count of 531 is slightly above that range (because entities are exempt from the df gate), but in the right order of magnitude. The old count of 12,000+ was 20-50x too many — a clear signal that the algorithm was wrong, not just the parameters.

### Per-step timing is the most useful telemetry

The `FinalizeResult.steps[]` array with per-step name, duration_ms, status, and detail is more valuable than any other logging. It immediately shows: which step is the bottleneck (usage_recount was 5s, now 135ms), which step failed (phrase_dedup hit CPU limit), and whether a fix worked (delete_orphans went from 0 to 66). Add this pattern to any multi-step pipeline from day 1.

### Updated lesson list

13. TF-IDF is for document retrieval, not topic extraction — use YAKE or similar for short texts
14. Noise word lists don't scale — use structural filters (df thresholds, suffix heuristics, POS patterns)
15. Multi-step pipelines must be resilient (continue on error) with per-step observability
16. D1 has per-query CPU limits — batch by actual rows, not sparse ID ranges
17. Re-enrichment must clean up old state, not accumulate alongside new state
18. Test locally with real data before deploying — the feedback loop is 100x faster
19. Heap's law gives you the expected topic count for your corpus size — use it as a sanity check
20. Per-step timing is the highest-value telemetry for pipeline debugging

## What we learned about typography and design consistency

The typography work happened after all the pipeline and topic extraction work was done. It revealed that visual inconsistency accumulates the same way technical debt does — one ad-hoc decision at a time, invisible until you audit the whole system.

### Ad-hoc sizes are not a type scale

The CSS had 22 distinct font sizes ranging from 0.55rem to 1.75rem. Many were separated by fractions of a pixel (0.85rem vs 0.88rem = 0.5px difference at 18px base). These create the illusion of hierarchy without the reality — the eye can't distinguish 15.3px from 15.8px. Replacing all 22 with a 7-step modular scale (1.25 ratio, Major Third) made the hierarchy legible: each step is visibly different from its neighbours.

### The font rule should be one sentence

After several rounds of normalisation, the font split simplified to: **Georgia for content (anything from the newsletter), sans-serif for chrome (anything the app generated)**. Panel links, episode cards, and browse links all display newsletter titles — they should use the content font. Labels, dates, counts, badges, and topic chips are app-generated — they should use the UI font. When a rule takes more than one sentence to explain, it has exceptions that will drift.

### Weight 500 is a non-decision

The CSS had three weights: 400, 500, and 600. The difference between 500 (medium) and 600 (semibold) is barely visible, especially at small sizes. Collapsing to two weights (400 for body, 600 for emphasis) made every weight choice intentional. Font-weight 700 appeared on the wordmark and one badge — both were brought to 600 for consistency.

### WCAG AA is a colour problem, not a code problem

The only failing contrast pair was `--text-light: #999` (2.78:1 on the warmest background). The famous `#767676` AA boundary grey also fails on warm off-white backgrounds — you need `#707070` to pass 4.5:1 on `#f7f5f0`. Changing one CSS variable fixed every instance site-wide because the design system used tokens, not hardcoded hex values. This is the strongest argument for design tokens: one fix, everywhere.

### Focus indicators must be visible, not decorative

The search input had `outline: none` replaced with `box-shadow: 0 0 0 2px var(--accent-light)`. The accent-light colour on white has a 1.12:1 contrast ratio — invisible. A focus ring that doesn't meet contrast requirements is functionally the same as no focus ring. The fix: `:focus-visible` with a 2px solid accent outline globally.

### letter-spacing drifts silently

Three different letter-spacing values (0.04em, 0.05em, 0.06em) were used for the same role (uppercase labels). The differences are imperceptible but the inconsistency means every new component has to guess which value to use. Standardising to 0.05em everywhere eliminated the guesswork.

### Updated lesson list

21. A type scale is a decision — 22 ad-hoc sizes is the absence of one. Use a modular ratio.
22. Font assignment should be one rule: content font for content, UI font for chrome.
23. Two weights (regular + semibold) cover every need. Weight 500 is a non-decision.
24. WCAG AA compliance is trivial when you use design tokens — one variable change fixes everything.
25. Focus indicators must meet contrast, not just exist. `outline: none` without a visible replacement is an accessibility failure.
26. Audit the CSS the same way you audit the pipeline — systematically, with measurable criteria, not by eyeballing individual pages.

## What we learned in the staged pipeline refactor and Yaket evaluation

The next phase of work was less about features and more about making the ingestion system explainable, rerunnable, and measurable. That work exposed a different class of failures: not bad UX or bad algorithms in isolation, but production-only schema drift, hidden provenance gaps, and the danger of evaluating extractors without a stable characterization harness.

### Test schemas can hide production schema drift

Two serious failures only appeared when we ran the full Komoroske corpus through a real Wrangler/D1 environment:

- `word_stats.word` was unique in test helpers but not in the real migration chain, so `ON CONFLICT(word)` worked in tests and failed in production-like runs.
- `topics.distinctiveness` existed in test helpers but was missing from the real migration chain, so finalization silently degraded until we inspected the live schema.

The lesson was not just "run migrations". The lesson was: **test helpers that reconstruct schema by hand will drift from production unless you treat them as a compatibility surface**. Bobbin now applies the checked-in D1 migration chain in tests and local pipeline bootstrap as well, so the safer rule is: keep one migration source of truth and make every verification path use it.

### JSON logs are not enough; pipeline telemetry must be queryable

We already had structured JSON in `ingestion_log`, but that still forced us to grep blobs and mentally reconstruct what happened. The big improvement was adding first-class tables:

- `pipeline_runs`
- `pipeline_stage_metrics`

Once stage metrics became queryable, the right questions became cheap:

- How many candidates were generated vs rejected early?
- Which phase is slowest?
- Which extractor mode was used?
- Did pruning or merging spike after a change?

If the metrics are not queryable, they are not really operational data.

### Provenance breaks whenever a late stage bypasses the main pipeline

The phrase-lexicon backfill step originally created valid live topics without creating matching audit rows. That meant final topics could exist with `provenance_complete = 0`, even though the system claimed end-to-end traceability.

The real lesson is broader: **every late insertion path is effectively a second ingestion pipeline**. If it does not emit the same audit/provenance artifacts as the main path, it is a correctness bug, not just an observability gap.

### Lineage should not live forever in the hot table

Keeping zero-usage merge lineage rows in `topics` made production state look dirtier than it really was. They were no longer live topics, but they still lived in the main working set. Archiving them to `topic_lineage_archive` preserved auditability without inflating the live topic table.

This is the same pattern as log compaction: **keep the history, but move it out of the hot path**.

### A "better extractor" is not automatically better for the product

Raw Yaket is clearly a stronger YAKE implementation than Bobbin's naive extractor, but the first direct comparison showed the wrong kind of win:

- cleaner structurally
- slower and chattier operationally
- still surfacing bad visible concepts like `agentic` and `saruman`

That is because Bobbin does not need "good keywords" in the abstract. It needs **durable corpus-navigation topics**. A single-document extractor optimized for local salience still needs to be tuned for a downstream system that cares about cross-chunk navigational quality.

### Runtime switches make algorithm comparisons honest

Adding `TOPIC_EXTRACTOR_MODE` was more important than adding Yaket itself. Without a runtime switch, every comparison would have required code edits and redeploys, and every result would have been contaminated by unrelated diffs.

The switch gave us three stable comparison modes:

- `naive`
- `yaket`
- `yaket_bobbin`

That turned extractor evaluation from opinion into experiment.

### Characterization tests are the right tool for pipeline evaluation

The most valuable new tests were not classic unit tests. They were characterization runs that captured full-corpus metrics for a named extractor mode and made them comparable over time.

For Bobbin, the useful characterization metrics were not just precision-like ideas. They were also structural and cost signals:

- visible topic count
- weak visible singleton count
- active entities / active phrases
- candidate rows / accepted / rejected
- merge rows
- archived lineage topics
- pipeline wall time

That is what makes future Yaket upgrades safe: not just "tests are green", but "the corpus shape stayed sane".

### Full-corpus comparison harnesses need their own operational design

The characterization harness taught us a small but important operational lesson: **evaluation tools themselves need batching, isolation, and failure reporting**.

We had to make the harness:

- use isolated Wrangler state
- batch large-doc ingest differently from small-doc ingest
- surface the latest `ingestion_log` failure instead of only returning `500`
- avoid loading giant fixtures eagerly in the default worker test lane

That sounds like harness plumbing, but it matters. If the comparison tool is flaky, you stop trusting the comparison.

### Repo-wide typechecking is a quality gate, not cleanup

Getting `tsc --noEmit` passing across the whole repo uncovered real issues:

- test env objects that did not actually satisfy `Bindings`
- route type mismatches that Vitest did not care about
- missing ambient declarations for `cloudflare:test` and `?raw` imports

The lesson is the same as with pipeline metrics: if a signal is optional, people stop believing it. A passing repo-wide `tsc` run makes the test suite more predictive because type-invalid fixtures and helper code can no longer hide in the gaps.

### Production secrets used for operational shortcuts become debt immediately

To finish live ingestion and deployment work, we temporarily deployed with a known admin secret. That was the pragmatic move to unblock the pipeline, but it also created an immediate follow-up task: rotate it. Operational shortcuts are sometimes necessary, but they should always create explicit cleanup work the moment they are used.

### Updated lesson list

27. Hand-maintained test schemas drift from production. Full-corpus runs against real Wrangler/D1 state are mandatory.
28. Structured JSON logs are helpful, but queryable stage-metrics tables are what make a pipeline operationally understandable.
29. Any late-stage write path that bypasses provenance/audit emission is a correctness bug.
30. Keep lineage history, but move it out of the hot table. Archive audit state instead of inflating live state.
31. A stronger keyword extractor is not automatically better for a corpus-navigation product; downstream quality criteria matter more than local keyword quality.
32. Runtime switches turn extractor debates into experiments.
33. Characterization tests are the right safety net for pipeline and extractor changes that affect corpus shape, cost, and visible quality.
34. Evaluation harnesses need batching, isolation, and good failure reporting just like production pipelines do.
35. Repo-wide `tsc --noEmit` is a product-quality gate because it catches invalid fixtures, helpers, and route contracts that example tests ignore.
36. Temporary operational secrets solve immediate problems but create immediate rotation debt.

## What we learned in the source-fidelity rollout and ingest-time LLM architecture

The next phase of work was about preserving the source more honestly and moving the LLM to the only place it makes economic and operational sense: once per episode, as close to ingest as possible. That work taught us a different set of lessons than the original build or the topic migrations. The hard problems were not feature ideas. They were storage limits, parser fidelity, repairability, and the difference between fixing code and fixing already-ingested production data.

### Fidelity is a storage contract, not just a rendering feature

The first instinct is to treat links, superscripts, list depth, images, and separators as a frontend concern: parse more, render more. But the real lesson was that fidelity is primarily a storage design problem. Once the system only stores flattened text, every downstream improvement turns into archaeology. The winning design was:

- raw HTML stays canonical
- rich parsed artifacts are stored explicitly
- normalized analysis text remains separate for deterministic extraction

That separation is what made later repairs possible. Without it, every parser bug would have required refetching or accepting irreversible data loss.

### Raw HTML is not a luxury backup; it is the recovery path

Persisting the original Google Docs HTML felt redundant until production-only bugs appeared. Then it became obvious that raw HTML is the only trustworthy source for:

- parser upgrades
- fidelity backfills
- fragment-link repair
- verifying whether the bug is in parsing, storage, or rendering

The important lesson is: **if you plan to improve a parser later, store the original input exactly as received**.

### D1 limits are schema constraints, not just performance quirks

The source-fidelity rollout hit several production-only limits that local logic alone did not reveal:

- row-size limits for large HTML and episode artifacts
- SQL variable limits on batched updates and lookups
- CPU sensitivity on wide correlated operations

The fix was not "optimize a query". The fix was to change the storage model:

- chunk large artifacts into side tables
- batch using actual row IDs
- separate hot working tables from large artifact payloads

That is a broader lesson: **when D1 says a row or statement is too large, the answer is often a different data shape, not a more clever SQL expression**.

### Preserve both sides of a reference or the link is still broken

The fragment-link bug was instructive. Rewriting a source link from `#id...` to `/chunks/...#id...` was only half the problem. The target anchor also had to survive parsing, storage, and rendering. A reference is only valid if both sides survive:

1. the source link is preserved and resolved
2. the destination anchor is preserved in stored rich content
3. the destination anchor is actually rendered into live HTML

That is the real lesson: **cross-document or cross-chunk references are two-part data, not one-part data**.

### Parser bugs often hide in inline structure, not block structure

The parser already preserved standalone anchors, but it missed inline `<a id="..."></a>` targets embedded inside list items. That created a subtle failure mode:

- source links looked valid in raw HTML
- target IDs existed in raw HTML
- parsed artifacts silently dropped the target anchor
- live pages rendered a dead link that looked structurally correct

This is why parser tests need to cover not just blocks, but also inline structural tokens living inside otherwise-normal content.

### Existing production data is a separate system you must migrate deliberately

Fixing code did not fix the live site. Already-ingested rows still contained old artifacts. That forced a separate operational step:

- repair existing chunk rows
- repair existing episode artifact chunks
- verify the repaired pages on live

The broader lesson is: **a parser/storage bug creates both a code bug and a data bug**. Shipping the code only fixes future ingests. You still need an explicit repair path for historical data.

### Data repair scope must include dependents, not just changed rows

One repair pass updated only the obviously changed source rows. That was not enough, because target chunks that now needed preserved anchor IDs were still serving stale rich content. The correct repair scope was broader than "rows whose href changed". It had to include all rows in affected episodes whose stored artifacts depended on the new parse behavior.

This is the operational version of dependency tracking: **repair the closure of affected data, not only the rows that look obviously different at first glance**.

### Episode-level LLM caching is the right unit of expensive intelligence

Running the LLM at episode ingest time turned out to be the right boundary for three reasons:

- it is much cheaper than per-chunk invocation
- it captures thematic context that chunk-level calls miss
- it makes downstream reruns deterministic because the expensive semantic proposal step is cached

The key design rule held up well: **the LLM proposes, deterministic code decides**.

### The LLM's biggest win was architectural, not magical product quality

The LLM did not suddenly transform the visible topic metrics by itself. The bigger win was that it changed the shape of the system in a useful way:

- every episode now has a cached proposal artifact instead of requiring repeated semantic calls
- downstream pipeline experiments can be rerun deterministically against the same semantic proposals
- topic promotion still stays bounded by deterministic evidence and corpus rules
- proposals now carry chunk-level evidence, which makes audits and debugging substantially easier

The practical result was not "the LLM fixed topic quality in one shot". The practical result was: **semantic hints became persistent, inspectable, and cheap to reuse**. That is a stronger foundation for iteration than a one-time metric spike would have been.

### Model output contracts must be treated as hostile input

Workers AI output was not stable enough to trust casually. Real failures included:

- variable response envelopes
- fenced JSON
- control characters
- malformed content that was close to valid but not valid enough

The lesson is not that the model is bad. The lesson is that **LLM output is an external input format and must be normalized, sanitized, and validated like any other untrusted payload**.

### Live audits need representative pathological pages, not generic smoke checks

The most valuable verification was not "page returns 200". It was targeted live inspection of pages known to contain:

- superscript footnotes
- nested lists
- images
- separators
- internal fragment links

Those pathological pages exposed issues that broad route tests and generic samples did not. The right mental model is that live audits are characterization tests for real content, not just manual spot checks.

### Documentation is part of the pipeline, not commentary about it

Once the pipeline had raw HTML preservation, chunked artifact storage, episode-level LLM caching, deterministic reruns, backfill routes, and repair-specific behavior, the old "pipeline" doc was no longer enough. The system had become too stateful and too operationally subtle to leave implicit.

The lesson is simple: **if a pipeline has distinct ingest, cache, deterministic rerun, and repair paths, those paths need first-class documentation or the system will become tribal knowledge**.

### Updated lesson list

37. Source fidelity is primarily a storage contract; rendering is downstream of that decision.
38. Store raw source input exactly as fetched if you ever expect parser bugs or parser evolution.
39. D1 row-size and statement-size limits usually require a different data shape, not just faster queries.
40. Cross-chunk references only work when both the source link and the destination anchor survive parse, storage, and rendering.
41. Parser tests must cover inline structural tokens inside normal content, not just top-level block boundaries.
42. Fixing an ingest bug requires both a code deploy and a historical data repair plan.
43. Data repairs must update the full dependent artifact set, not just the rows with the most obvious diff.
44. Episode-level LLM caching is the right economic boundary: expensive semantics once, deterministic reruns forever.
45. LLM responses are untrusted external payloads and need sanitization, schema validation, and deterministic evidence checks.
46. Live audits should target the weirdest real pages in the corpus, because that is where fidelity bugs actually surface.
47. Once a pipeline has separate ingest, cache, rerun, and repair paths, documentation becomes part of the system, not optional explanation.

## What we learned in the layout cleanup, browse reuse, and summary-spec pass

The next phase of work was less about ingestion or extraction and more about making the product feel coherent. That exposed a different class of failures: not broken data, but broken alignment, unnecessary UI variety, misleading affordances, and route-specific designs that drifted away from the rest of the site.

### Visual layout bugs have to be debugged in a real browser

We were wrong when we tried to reason about homepage alignment from rendered HTML alone. The actual problems only became obvious in the browser:

- the hero/preamble still contributed spacing above the main body
- `.home-main > .body-panel:first-of-type` did not hit `Latest` because the preamble was also a `section`
- `.rail-panel-list a` overrode the intended flex layout on recent-episode rows

Playwright-level inspection of bounding boxes and computed styles found the real causes and verified the fix. The lesson is simple: **alignment, wrapping, spacing, and rhythm are browser facts, not markup guesses**.

### Shared layout primitives are only useful when they eliminate real drift

The rail cleanup worked once we stopped tolerating page-by-page variation and extracted the pieces that were already repeating:

- `rail-stack`
- `rail-panel`
- a shared heading-row pattern
- later, `BrowseIndex` row primitives for browse-style bodies

This was useful not because abstraction is inherently good, but because it removed accidental differences between pages. A shared primitive is worthwhile when it deletes variation, not when it creates a new layer to think about.

### Reuse has to be visual as well as functional

The summary-page spec got much better once the rule became: **no summary-only chrome, no summary-only interaction model, no summary-only panel language**. Yearly and monthly summaries should be parameterizations of existing routes and existing UI parts, not a parallel mini-product.

That rule is stricter than "reuse some helper functions." It means the visible page should already feel native to the product before any new code is written.

### Not every technically-valid mode deserves to exist

Search browse mode was implementable and even reusable, but it was still the wrong product choice. Search results work best as chunk cards because they preserve context and scanability. Adding an alternate browse mode increased surface area without improving the core experience.

The lesson is: **a feature can be internally consistent and still be the wrong default, or the wrong feature entirely**. Remove modes that add choice without adding clarity.

### Help affordances should be rare, quiet, and non-duplicative

The `?` help pattern turned into a small but important design lesson. It caused multiple problems at once:

- it visually pulled attention away from the actual heading
- it pushed basic meaning into an extra interaction instead of clearer labels
- it often duplicated the browser's own tooltip behavior when `title` was present
- repeated across panels, it made the rail feel more like an instrument panel than an editorial surface

The broader lesson is: **if the interface needs a help icon everywhere, the labels or concepts are probably not clear enough yet**.

### Preserve the good part of an existing surface when polishing it

The homepage `Latest` panel already had a useful live-newsletter feel. The goal was not to normalize it into the same structure as every other list. The right move was to fix alignment and surrounding rhythm while preserving the part that made it feel current.

Consistency does not mean flattening every page into the same shape. It means keeping the parts that are intentionally distinctive and removing the parts that are accidentally inconsistent.

### CSS regressions often come from selector assumptions, not missing styles

Two of the most visible bugs in this phase were caused by selectors that were reasonable in isolation and wrong in the real DOM:

- a `:first-of-type` rule that matched the wrong section
- a generic anchor rule with higher practical impact than the page-specific row styles

That is a useful reminder that CSS bugs are often about incorrect assumptions regarding structure and specificity, not about forgetting to set a property.

### Product polish benefits from reversible experiments

Several ideas were tried and then removed after seeing them in context: pill tabs, browse mode in search, extra analytics-style episode panels, novelty sparklines in the rail, hovercard-style directions. That was healthy. The product got better when we treated those as experiments instead of commitments.

The lesson is: **for UX work, fast removal is as valuable as fast addition**. A short-lived experiment that sharpens the product is not wasted work.

### Updated lesson list

48. Visual alignment, wrapping, and spacing bugs must be debugged in a real browser with computed styles and element measurements.
49. Shared UI primitives are valuable when they remove accidental variation across pages, not when they add abstraction for its own sake.
50. Route reuse should be visual as well as functional; new summary pages should be parameterizations of existing surfaces, not bespoke mini-products.
51. A feature can be technically correct and still be the wrong UX. Remove alternate modes that add complexity without adding clarity.
52. Help affordances should be rare and non-duplicative. If every panel needs a `?`, the labels or concepts are underspecified.
53. Preserve intentionally distinctive structure when polishing a page; consistency is not the same as flattening everything into one pattern.
54. Many CSS regressions come from incorrect selector assumptions about real DOM structure and specificity, not from missing declarations.
55. UX iteration improves when additions and removals are both cheap; reversible experiments are a product-quality tool.

## What we learned in the D1 hardening and migration-bootstrap pass

The next round of work was less about product behavior and more about operational correctness. The visible bug was a D1 bind-limit failure, but the deeper lesson was that our local confidence had been built on the wrong things: tiny fixtures, handwritten schema bootstrap, and query shapes that only looked safe while the corpus was small.

### Production D1 failures are often query-shape bugs, not "database flakiness"

The key failures were deterministic:

- oversized `IN (?, ?, ...)` lists
- index-hostile `OR` predicates
- lookups whose real predicates had drifted away from the available indexes

Retrying those failures would only have replayed the same bad SQL. The real fix was to change the query shape: batch bounded ID lists, use subqueries/CTEs when batching would change semantics, and rewrite hot `OR` filters into planner-friendly unions.

### Tiny test fixtures can hide exact-scale failures

The `/topics` failure escaped because the test database and local persisted corpus were both much smaller than live. The code was not "sometimes broken". It was broken exactly when corpus cardinality crossed D1's practical statement limits.

The lesson is broader than bind limits: **if a product's correctness depends on result-set size, topic density, or corpus width, then scale itself is part of the contract and needs explicit regression coverage**.

### One migration chain must define reality

The most important cleanup was removing the handwritten test schema and making tests/local bootstrap apply the checked-in migration chain directly. Until that happened, every test pass carried an asterisk: it proved the app worked against a similar schema, not necessarily the real one.

The practical rule is simple: **schema drift is not a testing bug, it is a source-of-truth bug**. If migrations define production, migrations should also define tests and local repair paths.

### `EXPLAIN QUERY PLAN` is part of verification, not optional archaeology

Adding or rewriting indexes without checking the resulting plan leaves too much to assumption. The useful verification step was not just "the query still returns rows" but:

- which index did SQLite/D1 actually choose?
- did the query still force a temp B-tree sort?
- did a supposed optimization still scan the table?

That made several gaps obvious immediately, especially around audit tables, LLM evidence rows, and ordered episode/chunk lookups.

### Retry policy has to distinguish transient errors from deterministic failures

Queue consumers originally retried every failure. That is operationally convenient and logically wrong. A transient D1 reset or lock should retry. A deterministic SQL-shape error or application bug should not.

The lesson is: **broad retry behavior hides root causes and amplifies bad work**. Retry logic should encode an opinion about which failures can plausibly succeed on the next attempt.

### Environment isolation is part of database safety

Preview/local config that points at the real database is not just a configuration smell. It is an operational footgun. The fix here was small, but the lesson is durable: **preview, local, test, and live bindings should make the safe choice the default choice**.

### Updated lesson list

56. D1 incidents that appear intermittent are often deterministic query-shape bugs triggered by real corpus cardinality.
57. If correctness changes with corpus width or result-set size, scale must be part of the regression suite.
58. A handwritten test schema is a second source of truth; eventually it will contradict production. Use the real migration chain everywhere you can.
59. `EXPLAIN QUERY PLAN` belongs in the verification loop for schema and query changes, not only in postmortems.
60. Retry only transient D1/infrastructure failures; deterministic SQL or application bugs should fail fast.
61. Preview/local database isolation is part of correctness, not just deployment hygiene.
