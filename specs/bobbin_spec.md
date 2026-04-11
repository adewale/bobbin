Bobbin spec
Grab all of the content from: https://docs.google.com/document/d/1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA/edit?tab=t.0 and past/archived editions.

Have a weekly refresh cron trigger that fetches new content.

Core Problem: it has interesting stuff but there's too much to digest.

Ingest all of Komoroske's content.
Insert it into a Vectorize database.

Offer a timeline UI for seeing every episode.
Expose tags for every episode.

Expose a search interface.

Expose every chunk with its own URL.
Show related chunks for every chunk.
Expose tags on every chunk.
Allow browsing by tag.


Allow browsing by time.
Use year, month and publication day. Enable URL hacking and calendar browsing.

Optimise for SEO.

Offer a concordance view.

Use the Cloudflare platform and skill: https://github.com/cloudflare/skills

## Implementation notes

Content is fetched via public Google Docs export URLs (no auth required).
The docs must be shared as "anyone with the link can view".

Known doc IDs:
- 1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA (current)
- 1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0 (archive 1)
- 1GrEFrdF_IzRVXbGH1lG0aQMlvsB71XihPPqQN-ONTuo (archive 2)
