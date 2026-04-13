# Bobbin Layout & Grid Audit

Audited 2026-04-12 against `docs/design-language.md` intent and `public/styles/main.css` implementation.

---

## 1. Homepage (`/`)

### Grid: `home-with-margin` (line 420)
- **Grid definition**: `1fr 13rem` with `2rem` gap — matches the Tufte margin intent.
- **Issue: Header/main width mismatch.** Header nav is constrained to `max-width: var(--max-width)` (44rem) at line 38. Main is also `max-width: 44rem` at line 55. But `home-with-margin` adds a `13rem` margin column + `2rem` gap *inside* the 44rem container. This means the main content column shrinks to ~29rem on desktop — narrower than reading-width on other pages. The margin content does not sit *outside* the content column like true Tufte margins; it sits within the 44rem, squeezing the main column. **This is architecturally different from the Tufte margin used in `.topics-margin` (line 152), which uses `float: right` with a negative margin to escape the container.**
- **Recommendation**: Either widen `main` on the homepage to accommodate the margin (e.g., `max-width: 60rem` when `.home-with-margin` is present), or switch to the same float+negative-margin pattern used by `.topics-margin`.

### Latest Episode Panel (line 435)
- Well-structured. Padding/margin consistent (`0.75rem` internal, `1.5rem` bottom margin).
- The "See all N chunks" link (`.see-all`, line 248) uses `display: inline-block; margin-top: 1rem` — sits well.

### Mobile collapse (line 429-432)
- Grid collapses to `1fr` at 768px. Adds `border-top`, `padding-top: 1rem`, `margin-top: 1rem` to `.home-margin`. Clean collapse.

### Hero (line 69-71)
- `padding: 0.75rem 0 1.25rem` — asymmetric top/bottom padding. Intentional visual weight toward content below. Fine.
- `margin-bottom: 1.5rem` — consistent section spacing.

**Verdict**: Functional but the main column squeeze is the biggest layout issue on the site.

---

## 2. Episodes Index (`/episodes`)

### Year/Month/Episode structure
- `.browse-year` (line 310): `margin: 1.5rem 0` — consistent vertical rhythm.
- `.browse-month` (line 312): `margin: 0.75rem 0 0.75rem 0` — half the year spacing, creating hierarchy. Good.
- `.browse-episodes li` (line 315): `padding: 0.5rem 0`, `min-height: 2.75rem` — touch-friendly, consistent.

### Format badges (line 319)
- `.format-badge` uses `margin-left: 0.35rem` to separate from chunk count. Properly aligned within the flex row.
- **Minor issue**: The format badge sits inside `<span class="meta">` alongside chunk count text. The badge's `display: inline-block` works but the badge is a child of the meta span, not a sibling — so it appears right-joined with "4 chunks" text. This is fine visually.

### Page count (line 249)
- `.page-count` has `margin-bottom: 1rem` but no top margin. Since `main` already has `margin: 1.5rem auto 2.5rem` and `padding: 0 1.5rem`, the page count sits at the top of main with no heading — just "79 episodes". This works; it's understated per design intent.

### Spacing hierarchy
- Year headings: `border-bottom: 2px solid var(--accent)`, `padding-bottom: 0.25rem` — creates visual anchors.
- Month headings: `text-transform: uppercase`, `letter-spacing: 0.04em`, `color: var(--text-muted)` — clearly subordinate.
- **Spacing rhythm is good**: 1.5rem between years, 0.75rem between months, 0.5rem between episodes.

**Verdict**: Clean. No issues.

---

## 3. Episode Detail (`/episodes/:slug`)

### Topics Marginalia (`.topics-margin`, lines 148-157)
- **Desktop (min-width: 769px, line 151)**: `float: right; width: 12rem; margin: 0 -14rem 1rem 1rem`. The negative right margin of -14rem pulls the topics *outside* the 44rem container into a true Tufte margin. This works correctly.
- **Mobile (max-width: 768px, line 155)**: Topics move below content with `order: 99`, `margin: 1.5rem 0 0`, `padding-top: 1rem`, `border-top` separator. Clean collapse.
- **Issue**: The float approach means topics appear in source order (early in the article element, before chunks). On desktop this is fine (floated right). But if the float doesn't clear properly with very few chunks, the topics margin could overlap the episode-nav. No `clear: both` is set on `.episode-nav` or `.episode-chunks`.

### Chunk Accordions (`.episode-chunks`, lines 252-265)
- `summary` padding: `0.6rem 0` — consistent across all chunks.
- `min-height: 2.75rem` — 44px+ touch target. Good.
- `.chunk-body` padding: `0 0 1rem 2rem` — left indent creates visual nesting. Good.
- Single-line chunks (`.chunk-row-single`, line 265) match the same `gap: 0.5rem`, `padding: 0.6rem 0`, `min-height: 2.75rem` as accordion summaries. Consistent.

### Prev/Next Nav (`.episode-nav`, line 304)
- `margin: 2rem 0; padding: 1rem 0; border-top: 1px solid var(--border)` — well-spaced.

**Verdict**: Good. The float-based margin is the correct Tufte approach. Minor float-clearing risk.

---

## 4. Chunk Detail (`/chunks/:slug`)

### Tufte Layout (`.tufte-layout`, line 106)
- `max-width: var(--max-width)` — matches main width. Good.
- The Tufte layout is actually the *notes* layout. For `notes` format chunks, the class is `chunk-compact` (line 294), which also uses `max-width: var(--max-width)`.

### Para-with-margin Grid (`.para-with-margin`, line 108)
- `grid-template-columns: 1fr 13rem; gap: 1.5rem` — each paragraph gets its own grid row with a margin note column.
- **Issue: Same squeeze problem as homepage.** Inside a 44rem container, the 13rem margin + 1.5rem gap leaves only ~29.5rem for the paragraph text. Unlike `.topics-margin` (which uses float + negative margin to escape the container), `.para-with-margin` puts the margin column *inside* the container. The reading column is noticeably narrower than on other pages.
- **Recommendation**: Either use the float+negative-margin pattern, or increase `main` max-width on chunk detail pages to ~60rem (like the homepage suggestion).

### Margin Notes (lines 113-116)
- `font-size: 0.75rem` — appropriately smaller than body text.
- `.margin-note-trailing` (line 116): `margin-top: 0.5rem` — for overflow margin notes that don't pair with a paragraph. Adequate.

### Mobile (line 109-112)
- Grid collapses to `1fr`. Margin notes get `border-left: 2px solid var(--accent-light); padding-left: 0.75rem; margin: 0.25rem 0 0.75rem`. This is a clean inline treatment that visually connects them to the accent color system.

### Chunk Nav (`.chunk-nav`, line 298)
- Identical structure to `.episode-nav`. `margin: 2rem 0; padding: 1rem 0; border-top`. Consistent.
- `max-width: 45%` on nav links prevents long titles from colliding. Good defensive CSS.

### More-on-this Section (`.more-on-this`, line 278)
- `margin: 2rem 0; padding: 1.25rem; background: var(--bg-warm); border-radius: 6px` — card-like treatment. Matches `.most-connected` (line 268). Consistent.

**Verdict**: The para-with-margin grid squeezes reading width. This is the second instance of the same pattern (shared with homepage).

---

## 5. Topics Index (`/topics`)

### Sparkline Grid (`.multiples-grid`, line 127)
- `grid-template-columns: repeat(4, 1fr); gap: 0.5rem` — tight grid. Good density for small multiples.
- **Responsive breakpoints**: `768px → 3 columns` (line 133), `480px → 2 columns` (line 134). Correct cascade.

### Cell Heights
- `.multiple-cell` (line 128): `min-height: 5rem`, `display: flex; flex-direction: column`.
- `.multiple-spark` (line 131): `height: 32px; margin-top: auto` — pushes sparkline to bottom, name to top.
- **Issue**: Cells with longer topic names (e.g., "disconfirming evidence") will be taller than cells with short names (e.g., "vibe coding"). The `min-height: 5rem` doesn't enforce equal height — CSS Grid's implicit row height will equalize within each row, but rows themselves may differ. In practice, grid `auto` rows make all cells in a row the same height as the tallest cell in that row. Cross-row height variation is expected and acceptable for this content type.

### Intro Text (`.page-intro`, line 125)
- `font-size: 0.85rem; margin-bottom: 1rem` — sits between the search form and the grid. The search form has no bottom margin of its own in this context (it's part of the Layout component but the form is immediately followed by `.page-intro`). There's `1rem` between intro text and grid via `margin-bottom: 1rem`.

### Search form on topics page
- **Observation**: The topics page includes a search form at the top (visible in HTML). This is the same `.search-form` used on the search page. It appears before the `.page-intro` paragraph. The spacing between the search form and intro text relies on the form's implicit margin (none in CSS — form elements have reset margin from line 2). The `p.page-intro` has no top margin.
- **Issue**: The search form's `button` and `input` provide their own height, but there's no `margin-bottom` on `.search-form`. The gap between the form and `.page-intro` is just the default (0). Visually they may appear too close.
- **Recommendation**: Add `margin-bottom: 1rem` to `.search-form` or `margin-top: 0.75rem` to `.page-intro` when it follows the form.

**Verdict**: Grid is well-done. Minor spacing gap between search form and intro text.

---

## 6. Topic Detail (`/topics/:slug`)

### Unstyled classes
- **`topic-header-stats`**: Used at `topics.tsx:89` — `<p class="topic-header-stats">`. No CSS rule exists. Falls back to base `p` style (`margin-bottom: 1rem`). The content ("1,030 mentions - 123 chunks - 12 episodes") renders as body serif text at 18px. It should probably be `font-family: var(--font-ui)` and smaller, consistent with `.page-count` or `.chunk-meta`.
- **`topic-distinctiveness`**: Used at `topics.tsx:95` — no CSS. Falls back to `p`. The "113.6x distinctiveness vs baseline" text renders as full-size serif body text. Should be styled as metadata (smaller, `font-ui`, muted color).
- **`topic-related`**: Used at `topics.tsx:101` — `<nav class="topic-related">`. No CSS. The "Related: cognitive labor - claude - ..." text renders as body serif. The `<span class="topic-related-label">` is also unstyled. Should be sans-serif, smaller, muted.
- **`topic-mentions`**: Used at `topics.tsx:90` — `<span class="topic-mentions">`. No CSS. Inherits from parent `p`.

**This is the highest-priority issue in the audit.** Four classes on the topic detail page have no CSS at all. The page header area looks unstyled — serif text, full size, no visual hierarchy between the h1, stats, distinctiveness ratio, and related topics.

### Sections
- Dispersion plot (`.topic-dispersion`, line 390): `margin: 1rem 0`. Compact. Good.
- Sparkline (`.topic-sparkline`, lines 332-333): Defined twice — `margin: 1.5rem 0; padding: 1rem; background: var(--bg-warm)` then overridden to `margin: 1rem 0` on line 333. The second rule wins, removing the padding and background. **Bug or intentional?** The padding/background from line 332 is lost.
- KWIC table (`.topic-kwic`, line 395): `margin: 1.5rem 0`. Section heading at `0.9rem`, `font-weight: 600`. Good.
- Slopegraph (`.topic-slopegraph`, line 415): `margin: 1.5rem 0`.
- Episode bars (`.topic-episode-timeline`, line 336): `margin: 1.5rem 0`.

### KWIC table mobile (line 404)
- `font-size: 0.7rem; max-width: 10rem` per cell at 640px. Cells have `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. Handles overflow correctly — truncates with ellipsis.

### Breadcrumb spacing
- `.breadcrumbs` (line 168): `margin-bottom: 1rem`. The h1 follows immediately. `h1` has `margin-bottom: 0.5rem`. Then `topic-header-stats` (unstyled `p`) has `margin-bottom: 1rem`. The spacing cascade is: breadcrumb (1rem gap) → h1 (0.5rem gap) → stats (1rem gap) → distinctiveness (1rem gap) → related (1rem gap) → dispersion. That's 4.5rem of vertical space before any data visualization. **The header area is verbose and loose** — consider tightening the stats/distinctiveness into one line, or reducing margins.

**Verdict**: Topic detail has the most issues. Four unstyled classes. Duplicate sparkline CSS (line 332 overridden by 333). Header area needs tightening.

---

## 7. Search (`/search`)

### Form alignment
- `.search-form` (line 74): `display: flex; gap: 0.5rem; max-width: 100%`. Fills the 44rem main column. Input has `flex: 1`. Good.
- `autofocus` attribute is present in HTML. Confirmed working.

### Empty state
- When no query: just the search form and a deferred `search.js` script. Minimal — appropriate.

### Results
- Results use `.chunk-card` (line 89): `padding: 1rem 0; border-bottom: 1px solid var(--border)`.
- Result count uses `.search-results > p:first-child` (line 247): `margin-bottom: 1rem`. The count appears as "20 results for 'software'" — styled with `font-ui, 0.85rem, text-light`. Good.
- `<mark>` highlighting (line 250): accent-light background, `padding: 0.05rem 0.15rem`. Subtle, effective.

### Spacing
- No `margin-top` between form and results. The form has no bottom margin. The `.search-results > p:first-child` has no top margin. Gap between form and "20 results" relies on the `p` element's base `margin-bottom: 1rem` from line 64 — but this is the paragraph *inside* search-results, not a margin between form and results section. The actual gap comes from `section.search-results` having no top margin or padding.
- **Issue**: The search form butts directly against the results with no vertical breathing room. This matches the topics page issue.
- **Recommendation**: Add `margin-bottom: 1.25rem` to `.search-form`.

**Verdict**: Functional. Tight spacing between form and results.

---

## CSS-Wide Checks

### 1. Spacing Scale

Extracted unique spacing values (margin, padding, gap). The scale is *mostly* based on `rem` multiples of 0.25:

| Scale step | Values used |
|---|---|
| 0.1rem | padding-bottom, padding fine-tuning |
| 0.15rem | cell padding, mark padding |
| 0.2rem | fine padding |
| 0.25rem | small margins, padding, gap |
| 0.3rem | topic gap, pill padding, diff entries |
| 0.35rem | breadcrumb separator, pill padding, legend gap |
| 0.4rem | header mobile padding, table cell padding |
| 0.5rem | common section padding, header padding, gap, search gap |
| 0.6rem | chunk row padding, cell padding |
| 0.75rem | header gap, card internal padding, section margins |
| 1rem | section spacing, nav padding, breadcrumb margin |
| 1.25rem | card/section padding, hero padding-bottom, chunk padding |
| 1.5rem | main top margin, section margins, h2 top margin, grid gap |
| 2rem | nav section margins, grid gap |
| 2.5rem | main bottom margin |
| 3rem | sparkline label area |

**Assessment**: Not a strict mathematical scale (e.g., 4px/8px/16px), but the values cluster around multiples of 0.25rem. The sub-0.5rem values (0.1, 0.15, 0.2, 0.3, 0.35, 0.4) are used for fine-grained padding on small UI elements (pills, table cells, marks). The larger values (0.5, 0.75, 1, 1.25, 1.5, 2, 2.5) form a loose but reasonable scale. **Not arbitrary — just not formalized.** For a Tufte-influenced design, this pragmatic approach is fine; the spacing serves the content rather than conforming to an abstract grid.

### 2. `max-width` Consistency

- `var(--max-width)` (44rem) is used on: `header nav` (line 38), `main` (line 55), `.tufte-layout` (line 106), `.chunk-compact` (line 294).
- **Consistent.** All content-containing elements use the same 44rem width.
- The homepage grid and para-with-margin grid subdivide this 44rem, creating narrower reading columns (discussed above).

### 3. Breakpoint Consistency

Three breakpoints are used:
- **480px** (lines 47, 134): Mobile-small. Header compresses. Multiples grid → 2 columns.
- **640px** (lines 219, 404): Mid-mobile. KWIC table and word-stats bars hide/simplify visualization columns.
- **768px** (lines 109, 133, 155, 429): Tablet. Tufte margins collapse inline. Multiples grid → 3 columns. Homepage margin collapses.

**One inconsistency**: `.topics-margin` uses `min-width: 769px` (line 151) for the desktop rule and `max-width: 768px` (line 155) for mobile. This is correct (no gap), but the `769px` is the only `min-width` breakpoint in the file — all others use `max-width`. Not a bug, but slightly unconventional. The reason is clear: float margins should only activate on larger screens.

### 4. Gap vs Margin

- **Gap is used consistently** for sibling spacing in flex and grid contexts. Counted 20+ `gap` declarations.
- **Margins** are used for section spacing (vertical rhythm between sections like `.browse-year`, `.topic-sparkline`).
- **No inconsistency** — gap for inline siblings, margin for block-level section spacing. The right approach.

### 5. Header/Footer Alignment

- **Header**: `nav` constrained to `max-width: var(--max-width)` with `margin: 0 auto`. **But** header has `padding: 0.5rem 1rem` while main has `padding: 0 1.5rem`. The nav content starts at the 44rem boundary, same as main, so they align. The header *background* is full-width (warm color), which is correct — only the nav content aligns with main.
- **Footer**: `padding: 0.75rem 1rem; text-align: center`. Footer has no `max-width` constraint — it's full-width with centered text. This is fine since it's just a single line of centered text, but it means footer content doesn't left-align with main content. Not a problem given the footer's minimal content.

---

## Priority Summary

### High Priority (visible to users)

1. **Topic detail page: 4 unstyled classes** (`topic-header-stats`, `topic-distinctiveness`, `topic-related`, `topic-mentions`). The header area of every topic detail page renders as unstyled serif body text with no visual hierarchy. Add CSS for these classes — sans-serif, smaller size, muted color. (Affects `/topics/:slug`)

2. **Duplicate `.topic-sparkline` rule** (lines 332-333). Line 332 sets `margin: 1.5rem 0; padding: 1rem; background: var(--bg-warm); border: 1px solid var(--border); border-radius: 6px`. Line 333 overrides to just `margin: 1rem 0`, dropping the padding, background, border, and border-radius. One of these lines should be removed. (Affects `/topics/:slug`)

### Medium Priority (layout structure)

3. **Homepage and chunk detail reading width squeeze.** Both `.home-with-margin` (line 420) and `.para-with-margin` (line 108) put a 13rem margin column *inside* the 44rem container, reducing reading width to ~29rem. The `.topics-margin` component (line 152) solves this correctly with `float: right; margin: 0 -14rem 1rem 1rem` — pulling the margin outside the container. The grid-based layouts should follow the same pattern or increase `main` max-width on those pages.

4. **Search form spacing.** `.search-form` has no `margin-bottom`. On both `/search` and `/topics`, the form butts directly against the content below. Add `margin-bottom: 1rem` to `.search-form` (line 74).

### Low Priority (polish)

5. **Topic detail header area vertical spacing.** Between breadcrumb and first data viz, there are ~4.5rem of metadata text (h1 + stats + distinctiveness + related). Consider consolidating stats and distinctiveness onto one line, or reducing margins.

6. **Float clearing on episode detail.** The `.topics-margin` float (line 152) has no corresponding `clear` on `.episode-nav` or `.episode-chunks`. Could cause overlap with very short episode content. Add `clear: right` to `.episode-nav` or the `.episode-chunks` container.

7. **Breakpoint convention.** The single `min-width: 769px` (line 151) is functionally correct but stands out against the otherwise-consistent `max-width` convention. Consider refactoring to a `max-width: 768px` mobile-first override for consistency.
