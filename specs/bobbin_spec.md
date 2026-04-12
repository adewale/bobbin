Bobbin spec
Grab all of the content from: https://docs.google.com/document/d/1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA/edit?tab=t.0 and past/archived editions.

Have a weekly refresh cron trigger that fetches new content.

Core Problem: it has interesting stuff but there's too much to digest.

Ingest all of Komoroske's content.
Insert it into a Vectorize database.

Browse episodes grouped by year and month (accordion navigation).
Expose tags for every episode.

Expose a search interface (hybrid FTS5 + Vectorize with search operators).

Expose every chunk with its own URL.
Show related chunks for every chunk (Vectorize cross-references, tag-based fallback).
Expose tags on every chunk.
Allow browsing by tag (three-tier tag cloud: entities, proper nouns, concepts).

Offer a concordance view (word frequency, distinctiveness scoring).

Use the Cloudflare platform and skill: https://github.com/cloudflare/skills

## Removed features

- Timeline UI (redundant — episodes page already groups by year/month)
- Sitemap.xml (removed to reduce surface area)
- RSS/Atom feeds (archive of finished newsletter, not a live content stream)
- Tag diff page (redundant — tag detail page has inline "Evolution over time" section)

## Implementation notes

Content is fetched via public Google Docs export URLs (no auth required).
The docs must be shared as "anyone with the link can view".

Known doc IDs:
- 1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA (current)
- 1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0 (archive 1)
- 1GrEFrdF_IzRVXbGH1lG0aQMlvsB71XihPPqQN-ONTuo (archive 2)
