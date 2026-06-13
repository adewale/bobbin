# TODO

This file tracks only the current backlog. Historical migration work and completed pipeline phases are covered in the changelog and specs.

## Current priorities

### Product
- [ ] Deploy the current shared-surface UI to live so `/design`, hero/tagline treatments, and updated `/topics` sparklines match local.
- [ ] Decide whether the search page should gain a richer empty state or remain intentionally sparse.
- [ ] Decide whether trusted essay-format episodes need a more deliberate browsing treatment.

### Data and pipeline
- [ ] Preserve and render original outbound links from the ingestion source more completely.
- [ ] Revisit refresh cadence and decide whether the production cron should remain weekly or move to a fresher schedule.
- [ ] Evaluate when to replace the current extractor/runtime path with the Yaket-based path in production.
- [ ] Drop the schema remnants on `episodes` (`content_markdown`, `rich_content_json`, `links_json` are always written NULL) and the never-written `episodes.summary` / `chunks.summary` columns, removing their render fallbacks.
- [ ] Decide whether `source_html_chunks` should stay a write-only provenance archive or gain a TTL; it currently has no production reader.

### Testing and operations
- [ ] Decide whether AI visual tests should remain opt-in or gain CI credentials.
- [ ] Keep the computed-style audit in sync with the shared component inventory as `/design` evolves.
- [ ] Add a `preview_database_id` to `wrangler.jsonc` so `--remote` invocations of ops scripts cannot accidentally target the production D1.
