# TODO

This file tracks only the current backlog. Historical migration work and completed pipeline phases are covered in the changelog and specs.

## Current priorities

### Product
- [ ] Deploy the current shared-surface UI to live so `/design`, hero/tagline treatments, and updated `/topics` sparklines match local.
- [ ] Decide whether the search page should gain a richer empty state or remain intentionally sparse.
- [ ] Surface archive essay episodes more deliberately in browsing and topic exploration.

### Data and pipeline
- [ ] Preserve and render original outbound links from the ingestion source more completely.
- [ ] Revisit refresh cadence and decide whether the production cron should remain weekly or move to a fresher schedule.
- [ ] Evaluate when to replace the current extractor/runtime path with the Yaket-based path in production.

### Testing and operations
- [ ] Add the browser suite to CI with the local fixture and `dev:9090` workflow.
- [ ] Decide whether AI visual tests should remain opt-in or gain CI credentials.
- [ ] Keep the computed-style audit in sync with the shared component inventory as `/design` evolves.
