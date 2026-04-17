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

The lesson is not just "run migrations". The lesson is: **test helpers that reconstruct schema by hand will drift from production unless you treat them as a compatibility surface**. Full-corpus local runs against real Wrangler D1 state are the only trustworthy test for migration reality.

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
