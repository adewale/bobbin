# Design

Bobbin's current design system is text-first, editorial, and heavily shared across routes. The canonical live inventory for these patterns is the `/design` route in the app itself.

## Core tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--text` | `#2c2c2c` | Primary reading text |
| `--text-muted` | `#6b6b6b` | Support text, secondary descriptions |
| `--text-light` | `#707070` | Labels, captions, tertiary meta |
| `--bg` | `#fdfcfa` | Page background |
| `--bg-card` | `#fff` | Inputs and white card surfaces |
| `--bg-warm` | `#f7f5f0` | Shared panel and rail surface |
| `--accent` | `#c04000` | Active state and emphasis |
| `--accent-light` | `#fdf0e8` | Accent tint |
| `--accent-dark` | `#8b2e00` | Header/logo emphasis |
| `--viz` | `#5b6c7f` | Chart/sparkline signal colour |
| `--rail-signal-color` | `var(--viz)` | Shared sparkline token across rail and non-rail charts |
| `--border` | `#e8e4de` | Panel and divider borders |

## Typography roles

| Role | Tokens | Current use |
|------|--------|-------------|
| Content/title serif | `--font-body` | chunk titles, topic titles, longform reading |
| UI sans | `--font-ui` | nav, labels, controls, metadata, rail headings |
| Section heading | `.section-heading` | shared uppercase heading treatment across panels |
| Section metadata | `.section-meta`, `.section-meta-label` | shared range/mean/count/support text |

## Current page structure

- **Top-level archive pages**: `/`, `/episodes`, `/topics`
  - share `.page-preamble.hero`
  - use `.page-tagline`
  - typically avoid a large `h1`
- **Search**: `/search`
  - centers the page-level `SearchForm`
  - uses chunk cards as the sole search-results presentation
- **Detail pages**: `/episodes/:slug`, `/chunks/:slug`, `/topics/:slug`
  - use breadcrumbs plus a real `h1`
- **Design inventory**: `/design`
  - intentionally has an `h1`
  - shows the shared component catalogue and live component demos

## Shared components

- `TopicHeader`
- `TopicChartPanel`
- `TopicList` (replaces `TopicStrip`, `TopicRailList`, `TopicCloud`; layouts: `run` / `stack` / `multiples`; modifiers: `trending`, `count`, `salient`)
- `EmptyArchiveState`
- `BrowseSection`, `BrowseSubsection`, `BrowseRowList`, `BrowseRow`

## Principles

1. **Content first**: reading and archive scanning drive the layout.
2. **Shared surfaces over page-specific chrome**: warm panels, rail panels, section headings, and meta rows repeat instead of route-specific widgets.
3. **Editorial hierarchy**: primary titles use the content serif; labels and controls stay in the UI sans.
4. **Accent restraint**: accent is for active state and emphasis, not every chart or link.
5. **Deterministic local verification**: `/design`, the local fixture, and the computed-values audit all exist to make UI changes testable in a browser.
