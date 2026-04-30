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

Provide canonical period pages for a calendar slice of Bobbin content.

Every section is a deterministic projection of existing data through existing components. The page does not interpret, characterise, narrate, or generate prose. It must reuse or parameterize existing data logic, interaction patterns, and visual components. It must not introduce new UI elements.

## Non-goals

- No custom date-range UI
- No personalized "since your last visit" logic
- No new chart or panel types
- No new visual language
- No quarter / season / week / half-year periods (see *Period kinds* below)
- **No interpretive prose.** No editorial verbs, no characterisation, no claims that go beyond what the data literally says. Sentences may appear *only* through fixed templates in `buildPeriodSummary` (modelled on the existing `buildTopicSummary`); see the Summary panel section below.
- No LLM, no synthesis, no narrative generation. Every sentence on the page must be either fixed UI text or a substitution into a template enumerated in `src/lib/period-summary.ts`.
- No "thin period" rendering branch. Sparse periods are handled by the same per-panel emptiness checks as everything else.

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

`/eras/<slug>/` is reserved as a future axis sitting alongside `/summaries/`. Until a separate spec defines it:

- Do not surface era links from summary pages
- Reserve the `/eras/` URL space — do not use it for anything else
- Era data, when built, must live in a committed source file (e.g. `src/data/eras.ts`); routes must not generate era boundaries at request time

**Corpus-grounded constraint.** When eras are eventually defined, their boundaries must be derived from the actual Bobbin corpus, not from general AI history. As of 2026-04, the local corpus spans only 2024-12-09 → 2026-04-06 (69 episodes), entirely within what a general AI-history timeline would call the "agent era". Externally-sourced era schemes would produce empty or near-empty pages. `scripts/audit-era-boundaries.ts` provides a reproducible audit (first-appearance dates and per-quarter mention counts of marker terms); run it before proposing era boundaries.

Audit observations as of 2026-04 (raw output from the script — counts, not interpretations):

- `vibe coding` — first appears 2025-03-10; quarterly mention bins ▅ ▅ ▅ ▁ across 2025 Q1–Q4
- `Cursor` — first appears 2025-01-27; quarterly mention bins ▁ ▃ ▃ · across 2025 Q1–Q4 (dot = zero)
- `Claude Code` — first appears 2025-03-17; quarterly mention bins ▃ ▃ ▅ ▅ ▅ ▅ ▃ across 2025 Q1 → 2026 Q2
- `agent` and `swarm` — present from the first episode (2024-12-09); sustained across the corpus

Defining era *names* and *boundaries* from these counts is editorial work that belongs in the eras spec, not here.

## IA Position

`Summaries` is a first-class archive family alongside:

- `Episodes`
- `Topics`
- `Search`

## Indieweb-aligned restraint

Calendar archive pages in the indieweb tradition are navigation aids, not destinations. Bobbin's summary pages should respect that:

- The body provides navigation (representative chunks, episode timeline) plus a short deterministic summary panel
- The rail provides the analytical lens (deterministic counts and rankings)
- The summary panel uses the same template-only contract as the existing `buildTopicSummary` on topic detail pages: fixed sentence shapes populated from named observable inputs. No interpretation, no characterisation, no narrative.

## Composition Rule

Every summary section must be built from an existing page pattern:

- existing body panels: `body-panel`, `body-panel-list`
- existing rail panels: `rail-stack`, `rail-panel`, `rail-panel-list`, `rail-panel-heading-row`
- existing browse-body primitives: `BrowseSection`, `BrowseSubsection`, `BrowseRowList`, `BrowseRow`
- existing help/tooltip pattern: `topic-help-tip`
- existing row/link treatments: `list-row-link`, `list-row-title`, `list-row-meta`
- existing topic representation: `<TopicList>` component (`run` / `stack` / `multiples`)

Explicit reuse targets:

- representative chunk list → same `body-panel-list` + row treatment used by `Most Connected`
- episode timeline → same browse-body pattern used by `/episodes`
- right-rail sections → same `rail-stack` + `rail-panel` system used on episode/topic/chunk/home rails
- right-rail heading/help treatment → same `rail-panel-heading-row` + `topic-help-tip`
- topic-bearing rail rows → `<TopicList layout="stack">` with the appropriate modifier
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
   - episode count and chunk count, both pulled directly from `getEpisodesInPeriod` / `getChunksInPeriod`, in the existing metadata style
   - breadcrumbs back to `/summaries` and (for monthly) `/summaries/{year}`

2. **Summary panel**
   - existing `body-panel` shell, identical to the `Topic summary` panel on topic detail pages
   - rendered list comes from `buildPeriodSummary(facts)` in `src/lib/period-summary.ts`
   - `buildPeriodSummary` is the period analogue of `buildTopicSummary` (`src/lib/topic-detail.ts`): every sentence is a fixed template populated from named inputs (`periodLabel`, `episodeCount`, `chunkCount`, span dates, `topByMentions`, new-topic count + leader, intensified/declined counts, `topContrast`)
   - Returns at most 5 sentences. Returns `[]` for periods with zero episodes; the panel is then omitted entirely.
   - No sentence outside the templates enumerated in `period-summary.ts` may appear here. Tests pin exact outputs for fixture inputs.

3. **Representative chunks**
   - existing `body-panel-list`
   - rows use `BrowseRow` or `list-row-link`
   - sourced from `getMostConnectedInPeriod` — strict reach ranking, no editorial selection
   - omit the panel when the helper returns zero rows

4. **Episode timeline**
   - existing browse-body pattern
   - monthly summary: flat episode rows in descending date order. No day grouping.
   - yearly summary: grouped by month using closed-by-default accordions that wrap `BrowseSubsection` / `BrowseRowList` / `BrowseRow`
   - omit the panel when there are no episodes (the route 404s before reaching this case in practice)

### Right rail

Only existing panel types/patterns. Three panels, each deterministic:

| Panel | Render iff | Source | Component |
|---|---|---|---|
| `New Topics` | helper returns ≥ 1 topic | `getPeriodNewTopics(db, bounds)` | `<TopicList layout="stack">` |
| `Movers` | the previous period has ≥ 1 episode AND the helper returns ≥ 1 mover | `getPeriodMovers(db, current, previous)` | `<TopicList layout="stack">` with `trending` modifier (↑ for risers, ↓ for fallers, inheriting link color) and `count` carrying the absolute delta |
| `Archive Contrast` | helper returns ≥ 1 topic | `getPeriodArchiveContrast(db, bounds)` | `<TopicList layout="stack">` with `count` modifier carrying the spike ratio (e.g. `2.4× typical`) |

If all three panels are empty the rail is omitted entirely and the body renders single-column. No other rail panels.

## Required Semantics

### `Summary` panel

Modelled exactly on `buildTopicSummary`. The set of permitted sentence templates is the source of truth in `src/lib/period-summary.ts`. Implementation may not introduce a sentence shape that isn't enumerated there, and may not call any model, generator, or external service to fill the panel. Sentence order matches the helper's emission order. The panel is omitted when the helper returns an empty array.

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

Yearly pages reuse exactly the same sections and panel names as monthly:

- `Summary` (template-driven via `buildPeriodSummary`)
- `Representative Chunks`
- `New Topics`
- `Movers`
- `Archive Contrast`
- episode timeline/browse body

The main structural differences are:

- the yearly page uses month accordions for the timeline body
- the yearly page may show compact year cards on `/summaries` using the existing small-multiples card treatment

- monthly: flat episode rows in descending date order
- yearly: month-level grouping via closed accordions around `BrowseSubsection`

## Reuse Mapping

- Period `Movers / New / Archive Contrast`: use `src/db/periods.ts` helpers; render rows through `<TopicList layout="stack">`
- Period episode listing: reuse `BrowseIndex` components
- Summary page rail: reuse `rail-stack` + `rail-panel` + `rail-panel-heading-row` + `HelpTip`
- Summary index year cards: reuse the existing topic small-multiples card treatment rather than a summary-specific card primitive

## Visual Constraints

- No new color roles
- No new card styles
- No chips. Topics render through the shared `<TopicList>` component (`run`, `stack`, or `multiples` layout)
- Direction is conveyed by typographic glyphs (`→`, `↑`, `↓`), never by hue
- No new summary-only visual primitive; summary pages may compose existing `details/summary` accordion behavior and the existing multiples-card treatment
- If a summary needs a chart, it must reuse an existing sparkline/small-chart treatment already present in the product

## Index Page

`/summaries` should be a browse page, not a custom dashboard.

Recommended structure:

- group by year
- each year heading links to `/summaries/{year}`
- each year may show a three-card summary strip using the existing multiples-card pattern:
  - `Chunk volume`
  - `New topics`
  - `Spikiest months`
- list available monthly summaries using `BrowseRow`
- title format:
  - yearly: `2026` (via `periodLabel`)
  - monthly: `April 2026` (via `periodLabel`)
- metadata: episode count, chunk count
- month rows link to `/summaries/{year}/{month}`

Inclusion rules (deterministic):

- A year row is listed iff `getEpisodesInPeriod` returns ≥ 1 episode for that year
- A month row is listed iff `getEpisodesInPeriod` returns ≥ 1 episode for that month
- No "thin" / "thick" distinction; sparse periods are listed and link to a sparse summary page. The summary page handles its own emptiness via the per-panel rules above.

## Implementation Order

1. Add `/summaries`, `/summaries/{year}`, and `/summaries/{year}/{month_number}` routes; route handlers parse params via `parsePeriodPath`
2. Compose the page from existing components and the helpers in `src/db/periods.ts` — no new data layer code should be necessary
3. Render monthly and yearly summary pages using only existing body/rail/browse primitives
4. Add tests proving:
   - route shape and 404 behaviour for malformed periods
   - 404 for periods with zero episodes
   - `New` means new to corpus (not new vs the previous period)
   - monthly `Movers` compares to previous month; yearly `Movers` compares to previous year
   - `Movers` is omitted when the previous period has zero episodes
   - each rail panel is omitted when its source helper returns zero rows
   - the rail aside is omitted entirely when all three panels are empty
   - the `Summary` panel renders exactly the strings produced by `buildPeriodSummary` for the period's facts (no extra sentences, no rewording)
   - the `Summary` panel is omitted when `buildPeriodSummary` returns `[]`
   - no new panel classes or summary-only UI primitives are introduced

## Dependencies in place

These pieces have already landed and are available to the summaries PR with no additional refactoring:

- `src/components/TopicList.tsx` — `run` / `stack` / `multiples` layouts; `trending`, `count`, `salient` modifiers
- `src/lib/period.ts` — `Period`, `PeriodBounds`, `periodBounds`, `previousPeriod`, `periodLabel`, `periodPath`, `parsePeriodPath`, `isWithinPeriod`
- `src/lib/period-summary.ts` — `buildPeriodSummary(input)`, the deterministic template-driven analogue of `buildTopicSummary`
- `src/lib/topic-scoring.ts` — `weightedTopicScore`, `weightedDeltaScore` (shared with episode rail)
- `src/db/periods.ts` — every period-scoped query the spec calls for
- `BrowseSection / Subsection / RowList / Row`, `rail-stack / rail-panel / rail-panel-heading-row`, `HelpTip`, `Layout` — existing
