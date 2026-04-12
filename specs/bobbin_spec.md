Bobbin spec
Grab all of the content from: https://docs.google.com/document/d/1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA/edit?tab=t.0 and past/archived editions.

Have a weekly refresh cron trigger that fetches new content.

Core Problem: it has interesting stuff but there's too much to digest.

Ingest all of Komoroske's content.
Insert it into a Vectorize database.

Browse episodes grouped by year and month (accordion navigation).
Expose topics for every episode as Tufte marginalia.

Expose a search interface (hybrid FTS5 + Vectorize with search operators, topic: filter, entity alias expansion).

Expose every chunk with its own URL.
Show related chunks for every chunk (Vectorize cross-references, topic-based fallback).
Expose topics on every chunk as Tufte marginalia.
Allow browsing by topic (small multiples sparkline grid, entity tier, topic search).

Topic detail pages show: dispersion plot, KWIC, related topics, highlighted excerpts, episode density bars, evolution over time, slopegraph.

Homepage shows: latest episode panel with topic marginalia, ThemeRiver, three-column grid (Most Connected, Recent Episodes, Popular Topics).

Use the Cloudflare platform and skill: https://github.com/cloudflare/skills

## Removed features

- Timeline UI (redundant — episodes page already groups by year/month)
- Sitemap.xml (removed to reduce surface area)
- RSS/Atom feeds (archive of finished newsletter, not a live content stream)
- Tag diff page (redundant — topic detail page has inline "Evolution over time" section)
- Reading mode (removed to reduce surface area)
- Separate concordance pages (merged into /topics)

## Implementation notes

Content is fetched via public Google Docs export URLs (no auth required).
The docs must be shared as "anyone with the link can view".

Known doc IDs:
- 1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA (current)
- 1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0 (archive 1)
- 1GrEFrdF_IzRVXbGH1lG0aQMlvsB71XihPPqQN-ONTuo (archive 2)
