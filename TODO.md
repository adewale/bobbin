# TODO

## Done (this session)
- ✅ Full-sentence titles (no truncation)
- ✅ Tag tiers (People & Phrases / Key Concepts)
- ✅ Concordance visualization (Tufte bar chart with inline sparklines)
- ✅ Reading flow (accordion episodes, prev/next on chunks, "more on this topic")

## Remaining

### Code quality
- [ ] **D1 generics on remaining routes** — chunks.tsx, tags.tsx, search.tsx, api.tsx still have `as any` casts. The db/ boundary layer covers home and episodes. Extend to all routes.
- [ ] **Remove dead code** — doc-parser.ts is only used by tests (production uses html-parser.ts). stripToPlainText in text.ts unused in production. generateEmbeddings (plural) unused.
- [ ] **data/raw/ should be gitignored** — 15MB of HTML committed to the repo. Should be fetched on demand.

### Testing
- [ ] **GitHub CI secrets** — `CLOUDFLARE_API_TOKEN` needs to be added to repo settings for deploy workflow.
- [ ] **Playwright runs on CI** — needs chromium installed in the workflow.
- [ ] **Visual tests** — agent-browser tests need `AI_GATEWAY_API_KEY`. Not runnable in CI without a key.

### UX
- [ ] **Chunk titles** — full sentences are better than truncated, but real topic labels (e.g., "Selling software vs. selling outcomes") would be better still. Requires LLM-generated titles during ingestion.
- [ ] **Color scheme** — burnt orange + cream is arbitrary. No design rationale or connection to content.
- [ ] **Empty search state** — just a search box and nothing else. Could show trending terms or popular searches.
- [ ] **Tag search autocomplete** — filter-as-you-type works, but no autocomplete dropdown with suggestions.

### Performance
- [ ] **Concordance page is 59KB** — 50 inline SVG sparklines. Could be a single SVG or use CSS-only sparklines.
- [ ] **Most-connected query** — 141K rows scanned. Could be precomputed during enrichment.

### Data
- [ ] **Archive essays not fully surfaced** — 11 essay episodes exist but aren't prominently featured. Homepage could have an "Essays" section.
- [ ] **Cron untested in production** — Monday 6am UTC cron has never fired. Need to verify it works end-to-end.
