Bobbin Design Language

Philosophy: Tufte-influenced information density. Maximum data-ink ratio. Serif body text for reading, system sans-serif for UI chrome. The design trusts the content — no decorative elements, no hero images, no card shadows.

Color palette — warm neutrals with a single accent:
- Text: #2c2c2c (near-black, never pure black)
- Muted/light text: #6b6b6b, #999
- Background: #fdfcfa (warm off-white, not clinical white)
- Warm surface: #f7f5f0 (header, cards, badges)
- Accent: #c04000 (burnt orange) with light #fdf0e8 and dark #8b2e00 variants
- Borders: #e8e4de (warm gray, not cold)

Typography — three-font system:
- Wordmark: Libre Franklin 700 — used for the "BOBBIN" site title in the header. Uppercase, letter-spacing 0.05em, accent-dark color. Loaded via Google Fonts.
- Body: Georgia/Times New Roman (serif) at 18px, 1.7 line-height — optimized for long reading
- UI: system sans-serif stack — for navigation, labels, metadata, counts
- H1: serif, 1.75rem, italic, weight 400 — Tufte-style understated headings
- H2: serif, 1.2rem, weight 400 — same understated treatment
- H3: sans-serif, 0.95rem, weight 600 — functional subheadings

Layout: Single-column, 44rem max-width. Tufte margin notes on desktop (13rem side column via CSS grid). Collapses to inline on mobile. scrollbar-gutter: stable prevents layout shift.

Favicon: SVG "B" in Libre Franklin 700, accent-dark (#8b2e00), served as `/favicon.svg`.

Interaction patterns:
- Accordions for multi-line chunks (chevron rotates on open)
- Single-line chunks are plain rows, not expandable
- Topics as pills with hover state (border + background shift to accent)
- Breadcrumb navigation with / separators
- Active nav item: accent underline
- Search icon in header (no text label), autofocus on search page

Animation: Deliberately restrained. All behind prefers-reduced-motion. Page fade-in (0.2s), accordion slide-down (0.15s opacity), tag/bar hover transitions (0.15s). No bounces, no springs, no attention-grabbing motion.

Data visualization: Small multiples grid on the topics index (sparklines per topic). Topic detail pages show dispersion plots, sparklines with mean lines, slopegraphs, KWIC tables, and episode timelines. All use the accent color at low opacity for fills.

Mobile: 44px minimum touch targets. Header compresses (smaller font, tighter gaps). Margin notes become inline bordered blocks. Topics move below content.

What it is not: No dark mode. No card shadows. No gradients. No rounded corners beyond 3-6px on small elements. No icons beyond the search magnifying glass. No loading spinners. No skeleton screens.
