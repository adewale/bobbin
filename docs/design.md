# Design

## Colour scheme

Warm editorial palette inspired by printed essay collections. The accent colour draws the eye without competing with the text.

| Token | Value | Usage |
|-------|-------|-------|
| `--text` | `#2c2c2c` | Body text — soft black, easier to read than pure black |
| `--text-muted` | `#6b6b6b` | Secondary text, metadata, dates |
| `--text-light` | `#999` | Tertiary text, counts, labels |
| `--bg` | `#fdfcfa` | Page background — warm off-white, not clinical white |
| `--bg-card` | `#fff` | Card/panel backgrounds |
| `--bg-warm` | `#f7f5f0` | Highlighted sections, header, panels — cream |
| `--accent` | `#c04000` | Primary accent — burnt orange. Links, active states, bars, sparklines |
| `--accent-light` | `#fdf0e8` | Accent tint for backgrounds, tag hover, highlights |
| `--accent-dark` | `#8b2e00` | Accent shade for header logo, active nav |
| `--border` | `#e8e4de` | Subtle warm grey borders |

## Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-body` | Georgia, Times New Roman, serif | Body text, observation content, essays |
| `--font-ui` | System sans-serif stack | Navigation, labels, metadata, tags, buttons |
| `--font-mono` | SF Mono, Fira Code | Not currently used (reserved for code excerpts) |

## Design principles

1. **Content first** — the observations are the product. Minimise chrome.
2. **Tuftean data-ink** ��� every visual element should encode data. No decorative elements.
3. **Consistent width** — 44rem max-width everywhere. No layout shift between pages.
4. **Active nav** — current section underlined in the header. No breadcrumbs on top-level pages.
5. **Progressive disclosure** — accordions for episode observations, collapsible tag diffs, details/summary for tags on mobile.
6. **Stable scrollbar** — `scrollbar-gutter: stable` prevents layout shift.

## Page hierarchy

**Top-level** (no breadcrumbs, no h1): /, /episodes, /tags, /concordance, /search
**Detail** (breadcrumbs, h1): /episodes/:slug, /chunks/:slug, /tags/:slug, /concordance/:word
