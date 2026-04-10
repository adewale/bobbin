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
