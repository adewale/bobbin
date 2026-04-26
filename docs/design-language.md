Bobbin Design Language

Historical note: this file captures the design philosophy and token vocabulary. For the current route/component inventory, use `docs/design.md` and the in-app `/design` route.

Philosophy: Tufte-influenced information density with a calmer editorial surface. Serif body text for reading, system sans-serif for UI chrome, restrained panels, and no ornamental effects.

Color palette — warm neutrals with a single accent:
- Text: #2c2c2c (near-black, never pure black)
- Muted/light text: #6b6b6b, #707070
- Background: #fdfcfa (warm off-white, not clinical white)
- Warm surface: #f7f5f0 (header, cards, badges)
- Accent: #c04000 (burnt orange) with light #fdf0e8 and dark #8b2e00 variants
- Borders: #e8e4de (warm gray, not cold)

Typography — three-font system:
- Wordmark: Libre Franklin 700 — used for the "BOBBIN" site title in the header. Uppercase, letter-spacing 0.05em, accent-dark color. Loaded via Google Fonts.
- Body: Georgia/Times New Roman (serif) at 18px, 1.7 line-height — optimized for long reading
- UI: system sans-serif stack — for navigation, labels, metadata, counts
- H1: serif display treatment for detail pages and `/design`
- H2/H3: shared section and rail heading systems, with uppercase UI headings for most panels

Layout: single-column reading width by default, with an opt-in wide container (`62rem`) and shared page-with-rail grid when side content is needed. Rail content collapses below the main column on mobile. `scrollbar-gutter: stable` prevents layout shift.

Favicon: SVG "B" in Libre Franklin 700, accent-dark (#8b2e00), served as `/favicon.svg`.

Interaction patterns:
- Accordions for multi-line chunks (chevron rotates on open)
- Single-line chunks are plain rows, not expandable
- Topics as inline runs (`·` separated) or small-multiple cells; no pills. One `<TopicList>` component renders every topic surface via three layouts (`run`, `stack`, `multiples`) plus three modifiers (`salient`, `trending`, `count`).
- Direction is conveyed by typographic glyphs (`→`, `↑`, `↓`) in flow, inheriting link color. No semantic up/down hues.
- Breadcrumb navigation with / separators
- Active nav item: accent underline
- Search icon in header, with the page-level search form retained on the search route

Animation: Deliberately restrained. All behind prefers-reduced-motion. Page fade-in (0.2s), accordion slide-down (0.15s opacity), tag/bar hover transitions (0.15s). No bounces, no springs, no attention-grabbing motion.

Data visualization: Topics index uses small-multiple sparklines. Topic detail pages use `TopicChartPanel` for over-time and rank-over-time views. Shared sparkline signal now uses `--rail-signal-color`, not the accent colour.

Mobile: 44px minimum touch targets. Header compresses (smaller font, tighter gaps). Margin notes become inline bordered blocks. Topics move below content.

What it is not: No dark mode. No card shadows. No gradients. No rounded corners beyond 3-6px on small elements. No icons beyond the search magnifying glass. No loading spinners. No skeleton screens. No chips or badges around topic names. No green/red semantic colors.
