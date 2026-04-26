Period Summaries Spec

(Filename retained for path stability; the spec covers monthly and yearly summaries plus the reserved era axis.)

## Routes

- Index: `/summaries`
- Yearly summary: `/summaries/{year}`
- Monthly summary: `/summaries/{year}/{month_number}`

Examples:

- `/summaries/2026`
- `/summaries/2026/4`

URL parsing and labelling are centralised in `src/lib/period.ts`. Use `parsePeriodPath`, `periodPath`, `periodLabel`, `periodBounds`, and `previousPeriod`. Do not derive these inline.

## Goal

Provide canonical summary pages for a calendar period of Bobbin content.

The page is a synthesis of existing archive functionality. It must reuse or parameterize existing data logic, interaction patterns, and visual components. It must not introduce new UI elements.

## Non-goals

- No custom date-range UI
- No personalized "since your last visit" logic
- No new chart or panel types
- No new visual language
- No quarter / season / week / half-year periods (see *Period kinds* below)

## Period kinds

Two calendar period kinds are supported. The `Period` type in `src/lib/period.ts` is a discriminated union; new kinds may be added later without breaking callers, but the following are out of scope for v1:

| Kind | Status | Rationale |
|---|---|---|
| `month` (`/summaries/YYYY/M`) | ✅ supported | The grain readers can absorb in a sitting; aligns with how the source newsletter is paced. |
| `year` (`/summaries/YYYY`) | ✅ supported | The citable artifact ("Komoroske's 2025"); aligns with year-in-review convention. |
| `quarter` (`/summaries/YYYY/QN`) | ❌ not supported | No editorial blog uses calendar quarters in URLs. Cheap to derive from monthly data later if a quarterly editor's letter is ever written. |
| `season` | ❌ not supported | Hemisphere asymmetry breaks it as a global URL primitive. Literary magazines use seasons as branding, not navigation. |
| `week` (ISO 8601) | ❌ not supported | Week-in-review newsletters use issue numbers or dates, never week numbers. If Bits and Bobs has issue numbers, prefer those over `/W##`. |
| `half-year` | ❌ not supported | A finance convention; no public-web precedent. |
| `era` (curated, see *Era axis* below) | reserved | Hand-curated overlay; out of scope for the v1 summaries PR but the URL space is reserved. |

## Era axis (reserved, future work)

AI-history inflection points (ChatGPT shock, reasoning turn, agent era) cut across calendar boundaries. A future hand-curated `/eras/<slug>/` axis can sit alongside `/summaries/`, sharing the same data helpers (which take `PeriodBounds`, kind-agnostic) and the same component layer. Until eras are built:

- Do not surface era links from summary pages
- Reserve the `/eras/` URL space — do not use it for anything else
- Era data lives in a curated TS file (e.g. `src/data/eras.ts`), not the database
- Era pages may carry an editorial intro that calendar pages do not

## IA Position

`Summaries` is a first-class archive family alongside:

- `Episodes`
- `Topics`
- `Search`

## Indieweb-aligned restraint

Calendar archive pages in the indieweb tradition are navigation aids, not destinations. The synthesis lives in hand-written retrospectives or topic pages. Bobbin's summary pages should respect that:

- The auto-generated `Summary` body panel is lightweight (3–5 bullets at most), and may be empty when the period is too sparse to summarise meaningfully
- A future enhancement may allow a hand-written intro to override the auto-bullets — when present, prefer the editorial voice
- Calendar pages should not try to be dashboards. The rail provides the analytical lens; the body provides navigation

## Composition Rule

Every summary section must be built from an existing page pattern:

- existing body panels: `body-panel`, `body-panel-list`
- existing rail panels: `rail-stack`, `rail-panel`, `rail-panel-list`, `rail-panel-heading-row`
- existing browse-body primitives: `BrowseSection`, `BrowseSubsection`, `BrowseRowList`, `BrowseRow`
- existing help/tooltip pattern: `topic-help-tip`
- existing row/link treatments: `list-row-link`, `list-row-title`, `list-row-meta`
- existing topic representation: `<TopicList>` component (`run` / `stack` / `multiples`)

Explicit reuse targets:

- summary bullet/paragraph block → same `body-panel` treatment used by `Topic summary`
- representative chunk list → same `body-panel-list` + row treatment used by `Most Connected`
- episode timeline → same browse-body pattern used by `/episodes`
- right-rail sections → same `rail-stack` + `rail-panel` system used on episode/topic/chunk/home rails
- right-rail heading/help treatment → same `rail-panel-heading-row` + `topic-help-tip`
- topic-bearing rail rows → `<TopicList layout="stack">` with the appropriate modifier
- inline topic mentions in body prose → `<TopicList layout="run">`
- links to chunks, episodes, topics → existing page routes only; no summary-only destinations

No bespoke summary-only chrome.

## Data Model

Inputs are derived from `Period` via `periodBounds()`:

| Need | Helper |
|---|---|
| Episodes in the period | `getEpisodesInPeriod(db, bounds)` |
| Chunks in the period | `getChunksInPeriod(db, bounds)` |
| Topic chunk-counts in the period | `getPeriodTopicCounts(db, bounds)` |
| New-to-corpus topics in the period | `getPeriodNewTopics(db, bounds)` |
| Movers vs the previous comparable period | `getPeriodMovers(db, current, previous)` |
| Period-level over-indexing | `getPeriodArchiveContrast(db, bounds)` |
| Most connected chunks within the period | `getMostConnectedInPeriod(db, bounds)` |
| External links within the period | `collectExternalLinks(chunksInPeriod)` (reuse existing) |

All helpers live in `src/db/periods.ts` and accept `PeriodBounds` rather than `Period`, so the same code path serves any future period kind that produces date bounds (including eras).

The previous comparable period is computed via `previousPeriod(current)` then `periodBounds()`. For year `2026` → year `2025`. For month `2026/4` → month `2026/3`. For month `2026/1` → month `2025/12`.

## Page Structure

Use the existing `main-wide` + optional rail layout.

### Main column

1. **Header**
   - period label via `periodLabel(period)` — "April 2026" or "2026"
   - episode count / chunk count in existing metadata style
   - breadcrumbs back to `/summaries` and (for monthly) `/summaries/{year}`

2. **Summary panel** (optional)
   - existing `body-panel`
   - up to 5 bullets generated from period aggregates
   - omit entirely when the period is too sparse to summarise

3. **Representative chunks**
   - existing `body-panel-list`
   - rows use `BrowseRow` or `list-row-link`
   - sourced from `getMostConnectedInPeriod`

4. **Episode timeline**
   - existing browse-body pattern
   - monthly summary: flat episode rows in descending date order, optionally grouped by day
   - yearly summary: grouped by month
   - reuse `BrowseSection` / `BrowseSubsection` / `BrowseRowList` / `BrowseRow`

### Right rail

Only existing panel types/patterns. Candidate panels:

1. **`New Topics`** — `<TopicList layout="stack">` over `getPeriodNewTopics`
2. **`Movers`** — `<TopicList layout="stack">` with `trending` modifier (↑ for risers, ↓ for fallers, inheriting link color), over `getPeriodMovers`
3. **`Archive Contrast`** — `<TopicList layout="stack">` with `count` modifier carrying the spike ratio (e.g. `2.4× typical`), over `getPeriodArchiveContrast`
4. **`External Links`** — bespoke ul (matches `episode-insight-panel rail-panel` shape), over `collectExternalLinks(chunksInPeriod)`
5. **`Most Novel Chunks`** (optional) — same panel pattern used on episode pages, scoped to the period

## Required Semantics

### `New Topics`

`New` means new to the corpus, not just new relative to the previous period. The helper enforces this by gating on `MIN(published_date) BETWEEN start AND end`.

### `Movers`

Must use the same salience-weighted delta logic already used on episode pages (the shared `weightedDeltaScore` helper in `src/lib/topic-scoring.ts`). Direction is encoded by the `↑`/`↓` glyph appended to each topic anchor; never by color. A topic with no detectable change does not appear.

### `Archive Contrast`

Must remain topic-level, not chunk-level. The spike ratio compares the period's per-episode topic rate against the corpus per-episode rate.

### `Representative chunks`

Must link directly to existing chunk detail pages.

## Period Semantics

### Monthly summary

- period = all content in `{year}/{month_number}`
- comparison period = previous month (computed via `previousPeriod`)

### Yearly summary

- period = all content in `{year}`
- comparison period = previous year
- structure must remain visually consistent with monthly summaries — same page type at a larger aggregation level, not a different dashboard

Yearly pages should therefore reuse the same sections and panel names whenever possible:

- `Summary` (optional)
- `New Topics`
- `Movers`
- `Archive Contrast`
- `Representative Chunks`
- `External Links`
- episode timeline/browse body

The only meaningful structural difference is the grouping inside the browse body:

- monthly: day-level or flat episode rows
- yearly: month-level grouping

## Reuse Mapping

- Period `Movers / New / Archive Contrast`: use `src/db/periods.ts` helpers; render rows through `<TopicList layout="stack">`
- Period `External Links`: reuse `collectExternalLinks()` across all chunks in the period
- Period episode listing: reuse `BrowseIndex` components
- Summary page rail: reuse `rail-stack` + `rail-panel` + `rail-panel-heading-row` + `HelpTip`

## Visual Constraints

- No new color roles
- No new card styles
- No chips. Topics render through the shared `<TopicList>` component (`run`, `stack`, or `multiples` layout)
- Direction is conveyed by typographic glyphs (`→`, `↑`, `↓`), never by hue
- No new summary-only widget
- If a summary needs a chart, it must reuse an existing sparkline/small-chart treatment already present in the product

## Index Page

`/summaries` should be a browse page, not a custom dashboard.

Recommended structure:

- group by year
- list available yearly and monthly summaries using `BrowseRow`
- title format:
  - yearly: `2026` (via `periodLabel`)
  - monthly: `April 2026` (via `periodLabel`)
- metadata: episode count, chunk count
- a year row links to `/summaries/{year}`; month rows under it link to `/summaries/{year}/{month}`

Empty months (no episodes) must not be listed.

## Implementation Order

1. Add `/summaries`, `/summaries/{year}`, and `/summaries/{year}/{month_number}` routes; route handlers parse params via `parsePeriodPath`
2. Compose the page from existing components and the helpers in `src/db/periods.ts` — no new data layer code should be necessary
3. Render monthly and yearly summary pages using only existing body/rail/browse primitives
4. Add tests proving:
   - route shape and 404 behaviour for malformed periods
   - `New` means new to corpus
   - monthly `Movers` compares to previous month; yearly `Movers` compares to previous year
   - empty months render the empty state, not a broken panel
   - no new panel classes or summary-only UI primitives are introduced

## Dependencies in place

These pieces have already landed and are available to the summaries PR with no additional refactoring:

- `src/components/TopicList.tsx` — `run` / `stack` / `multiples` layouts; `trending`, `count`, `salient` modifiers
- `src/lib/period.ts` — `Period`, `PeriodBounds`, `periodBounds`, `previousPeriod`, `periodLabel`, `periodPath`, `parsePeriodPath`, `isWithinPeriod`
- `src/lib/topic-scoring.ts` — `weightedTopicScore`, `weightedDeltaScore` (shared with episode rail)
- `src/db/periods.ts` — every period-scoped query the spec calls for
- `src/lib/episode-rail.ts: collectExternalLinks` — already scope-agnostic, takes any chunk array
- `BrowseSection / Subsection / RowList / Row`, `rail-stack / rail-panel / rail-panel-heading-row`, `HelpTip`, `Layout` — existing
