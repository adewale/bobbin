# Bobbin

A searchable, browsable archive of Alex Komoroske's [Bits and Bobs](https://komoroske.com/bits-and-bobs) weekly observations, built on Cloudflare Workers.

**Live:** [bobbin.adewale-883.workers.dev](https://bobbin.adewale-883.workers.dev)

## What it does

Komoroske publishes 30–70 standalone observations each week about AI, software, ecosystems, and technology. Bobbin ingests this content from Google Docs, parses it into individual observations, and provides:

- **Hybrid search** — FTS5 + Vectorize semantic search with `before:`, `after:`, `year:`, `topic:`, and `"exact phrase"` operators
- **Archive browsing** — grouped episode browsing plus topic pages that show how attention shifts across the corpus
- **Source fidelity** — chunk and episode detail pages render stored rich-content artifacts, footnotes, links, and images directly
- **Shared editorial UI** — home, episodes, topics, and design surfaces all reuse the same layout, section-heading, and rail patterns
- **Local verification workflow** — fixture seeding, browser-level checks, and computed-style audits for local development

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

## Local development workflow

For browser-based local development, use the real app config and the canonical local fixture:

```bash
npm run fixture:local   # seeds a full local corpus + rail demo into the local D1
npm run dev:9090        # starts the app on http://localhost:9090
```

The fixture script prints a set of recommended URLs that exercise the main user-visible surfaces:

- home
- episodes index
- episode rail demo
- chunk detail and source-fidelity pages
- topics index and topic detail
- search
- design inventory

There is also a repeatable computed-style/browser audit for the current local app:

```bash
npm run audit:computed
```

If the local database is empty, the app will show an in-product setup hint that points back to `npm run fixture:local`.

For authenticated remote maintenance against the deployed worker, use:

```bash
BASE_URL="https://bobbin.adewale-883.workers.dev" \
ADMIN_SECRET="..." \
npm run maintenance:remote -- ingest-doc <doc-id> 100
```

The same script supports `refresh`, `enrich`, `finalize`, `backfill-source`, and `backfill-llm`.

Local browser runs, local pipeline runs, and Workers Vitest database bootstrap now all apply the same checked-in D1 migration chain. That keeps the test/local schema aligned with the real app schema, including FTS triggers, secondary indexes, and D1 hardening migrations.

## Architecture

Cloudflare Workers with Hono SSR. D1 for structured data, Vectorize for semantic search, Workers AI for embeddings, and Cloudflare Queues for background enrichment/finalization work.

```
Google Docs → fetch → parse → D1 + Vectorize
                                    ↓
                              Hono SSR → HTML
```

See [docs/architecture.md](docs/architecture.md) for the full system design.

Current design, architecture, and search docs:

- [docs/architecture.md](docs/architecture.md)
- [docs/design.md](docs/design.md)
- [docs/search.md](docs/search.md)

Historical research, audits, and specs in `docs/audit-*`, `docs/research-*`, and `specs/*` are retained as background material rather than current source-of-truth documentation.

Extractor tuning and characterization notes:

- [docs/yaket-bobbin-tuning.md](docs/yaket-bobbin-tuning.md)

## Testing

```bash
npm test              # workers-runtime Vitest suites
npm run test:real     # node/runtime corpus and CSS invariant suites
npm run test:e2e      # Playwright browser suite against BASE_URL/local server
npm run test:visual   # opt-in AI visual checks; requires AI_GATEWAY_API_KEY
npm run test:all      # workers + node Vitest suites
```

The default test and local bootstrap path uses the real migration files, not a handwritten test schema. `npm run test:all` is the canonical non-visual verification pass.

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
