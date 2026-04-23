Monthly Summaries Spec

## Route

- Index: `/summaries`
- Yearly summary: `/summaries/{year}`
- Monthly summary: `/summaries/{year}/{month_number}`

Example:

- `/summaries/2026`
- `/summaries/2026/4`

## Goal

Provide canonical summary pages for a month or year of Bobbin content.

The page is a synthesis of existing archive functionality. It must reuse or parameterize existing data logic, interaction patterns, and visual components. It must not introduce new UI elements.

## Non-goals

- No custom date-range UI
- No personalized "since your last visit" logic
- No new chart or panel types
- No new visual language

## IA Position

`Summaries` is a first-class archive family alongside:

- `Episodes`
- `Topics`
- `Search`

## Composition Rule

Every summary section must be built from an existing page pattern:

- existing body panels: `body-panel`, `body-panel-list`
- existing rail panels: `rail-stack`, `rail-panel`, `rail-panel-list`, `rail-panel-heading-row`
- existing browse-body primitives: `BrowseSection`, `BrowseSubsection`, `BrowseRowList`, `BrowseRow`
- existing help/tooltip pattern: `topic-help-tip`
- existing row/link treatments: `list-row-link`, `list-row-title`, `list-row-meta`
- existing topic links/tokens where they already appear elsewhere

Explicit reuse targets:

- summary bullet/paragraph block -> same `body-panel` treatment used by `Topic summary`
- representative chunk list -> same `body-panel-list` + row treatment used by `Most Connected` and `More on this topic`
- episode timeline -> same browse-body pattern used by `/episodes`
- right-rail sections -> same `rail-stack` + `rail-panel` system used on episode/topic/chunk/home rails
- right-rail heading/help treatment -> same `rail-panel-heading-row` + `topic-help-tip`
- links to chunks, episodes, topics -> existing page routes only; no summary-only destinations

No bespoke summary-only chrome.

## Data Model

Input for a month summary:

- all episodes with `year = {year}` and `month = {month_number}`
- all chunks inside those episodes
- all topics attached to those episodes/chunks
- all archive content before the month for novelty/comparison
- the immediately previous month for `Up / Down`

## Page Structure

Use the existing `main-wide` + optional rail layout.

### Main column

1. Header
- month title
- episode count / chunk count in existing metadata style

2. Summary panel
- existing `body-panel`
- 3-5 bullets or short summary paragraph
- content generated from existing period aggregates

3. Representative chunks
- existing `body-panel-list`
- rows use `BrowseRow` or `list-row-link`
- this is the period-level equivalent of `Most Novel Chunks`

4. Episode timeline
- existing browse-body pattern
- monthly summary: grouped by day or just listed in descending date order
- yearly summary: grouped by month
- reuse `BrowseSection` / `BrowseSubsection` / `BrowseRowList` / `BrowseRow`

### Right rail

Only existing panel types/patterns. Candidate panels:

1. `New Topics`
- reuse the episode-rail/new-to-corpus logic, aggregated for the period

2. `Up`
- reuse salience-weighted delta logic, but aggregated period vs previous comparable period

3. `Down`
- same as above

4. `Archive Contrast`
- reuse the existing topic-level over-indexing logic, but for the period

5. `External Links`
- deduplicated links across the period, using the existing external-link extraction

6. `Most Novel Chunks`
- optional if not already surfaced in the main column; if used, keep the same existing panel treatment

## Required Semantics

### `New Topics`

`New` means new to the corpus, not just new relative to the previous month.

### `Up / Down`

Must use the same salience-weighted delta logic already used on episode pages.

### `Archive Contrast`

Must remain topic-level, not chunk-level.

### `Representative chunks`

Must link directly to existing chunk detail pages.

## Period Semantics

### Monthly summary

- period = all content in `{year}/{month_number}`
- comparison period = previous month

### Yearly summary

- period = all content in `{year}`
- comparison period = previous year
- structure must remain visually consistent with monthly summaries
- it should feel like the same page type at a larger aggregation level, not a different dashboard

Yearly pages should therefore reuse the same sections and panel names whenever possible:

- `Summary`
- `New Topics`
- `Up`
- `Down`
- `Archive Contrast`
- `Representative Chunks`
- `External Links`
- episode timeline/browse body

The only meaningful structural difference is the grouping inside the browse body:

- monthly: day-level or flat episode rows
- yearly: month-level grouping

## Reuse Mapping

- Period `Up / Down / New`: parameterize `getEpisodeRailInsights()`-style logic into period-scoped queries/helpers
- Period `Archive Contrast`: reuse existing episode/topic contrast query shape at period scope
- Period `External Links`: reuse `collectExternalLinks()` across all chunks in the period
- Period episode listing: reuse `BrowseIndex` components
- Summary page rail: reuse `rail-stack` + `rail-panel`

## Visual Constraints

- No new color roles
- No new card styles
- No new chip style
- No new summary-only widget
- If a summary needs a chart, it must reuse an existing sparkline/small-chart treatment already present in the product

## Index Page

`/summaries` should be a browse page, not a custom dashboard.

Recommended structure:

- group by year
- list available yearly and monthly summaries using `BrowseRow`
- title format:
  - yearly: `2026`
  - monthly: `April 2026`
- metadata: episode count, chunk count

## Implementation Order

1. Add `/summaries`, `/summaries/{year}`, and `/summaries/{year}/{month_number}` routes
2. Add period-scoped aggregate helper(s) by parameterizing existing episode/topic logic
3. Render monthly and yearly summary pages using only existing body/rail/browse primitives
4. Add tests proving:
   - route shape
   - `New` means new to corpus
   - monthly `Up / Down` compare to previous month
   - yearly `Up / Down` compare to previous year
   - no new panel classes or summary-only UI primitives are introduced
