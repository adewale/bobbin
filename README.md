# Bobbin

A searchable, browsable archive of Alex Komoroske's [Bits and Bobs](https://komoroske.com/bits-and-bobs) weekly observations. Built on Cloudflare Workers.

**Live:** [bobbin.adewale-883.workers.dev](https://bobbin.adewale-883.workers.dev)

## What it does

Komoroske publishes 30–70 standalone observations each week about AI, software, ecosystems, and technology. Bobbin ingests this content from Google Docs, parses it into individual observations, and provides:

- **Hybrid search** — FTS5 + Vectorize semantic search with `before:`, `after:`, `year:`, and `"exact phrase"` operators
- **Concordance** — word distinctiveness analysis with inline sparklines showing temporal trends
- **Tags** — TF-IDF scored with named entity detection (Claude Code, Stratechery, Goodhart's Law)
- **Timeline** — browse by year/month with essay vs notes format detection
- **Cross-references** — "more on this topic" links between observations across episodes

## Quick start

```bash
git clone https://github.com/adewale/bobbin.git
cd bobbin
npm install
```

Create Cloudflare resources:

```bash
npx wrangler d1 create bobbin-db
npx wrangler vectorize create bobbin-chunks --dimensions 768 --metric cosine
```

Update `wrangler.jsonc` with your database ID, then:

```bash
npx wrangler d1 migrations apply bobbin-db --local
npm run dev
```

## Architecture

Cloudflare Workers with Hono SSR. D1 for structured data, Vectorize for semantic search, Workers AI for embeddings.

```
Google Docs → fetch → parse → D1 + Vectorize
                                    ↓
                              Hono SSR → HTML
```

See [docs/architecture.md](docs/architecture.md) for the full system design.

Extractor tuning and characterization notes:

- [docs/yaket-bobbin-tuning.md](docs/yaket-bobbin-tuning.md)

## Testing

```bash
npm test              # 273 vitest tests (Workers pool)
npm run test:real     # 34 tests against cached Google Doc HTML
npm run test:e2e      # 8 Playwright tests (desktop + mobile)
npm run test:all      # all of the above
```

## Search operators

| Operator | Example | Effect |
|----------|---------|--------|
| `"..."` | `"cognitive labor"` | Exact phrase match |
| `before:` | `before:2025-06-01` | Episodes before date |
| `after:` | `after:2024-01-01` | Episodes after date |
| `year:` | `year:2025` | Episodes from year |

## Project structure

```
src/
  db/           Typed D1 query boundary layer
  routes/       Hono route handlers (SSR)
  services/     Domain logic (search, tags, parsing)
  components/   JSX components
  jobs/         Ingestion pipeline (phased: fast insert + background enrichment)
  lib/          Pure utilities
```

## Licence

MIT
