# Topics: A Unified System for Navigating the Corpus

## Problem

Bobbin currently has two parallel systems for understanding what the corpus is about:

- **Tags** — TF-IDF extracted terms attached to chunks. Good at entities ("claude code", "simon willison") but capped at 5 per chunk, creating an artificial bandwidth limit. 75% of the 8,270 tags are used only 1-2 times.
- **Concordance** — Word frequency with distinctiveness scoring. Good at identifying the corpus vocabulary fingerprint but limited to single words, with no semantic grouping.

These serve the same user need ("what does Komoroske say about X?") through different lenses, producing redundant pages (`/tags/llms` vs `/concordance/llms`) that confuse rather than complement.

The codebase also uses inconsistent language: "tag", "observation", "chunk", "note" refer to overlapping concepts. This muddiness leaks into the UI.

## Proposal

Replace `/tags` and `/concordance` with a unified **`/topics`** system. A topic is a concept that appears across the corpus — identified by combining tag extraction, concordance data, co-occurrence analysis, and distinctiveness scoring.

## Language

These terms are used precisely throughout the codebase:

| Term | Meaning |
|------|---------|
| **Chunk** | The atomic content unit. A single observation, aphorism, or essay section. Stored in the `chunks` table. Displayed in accordions on episode pages and as standalone pages at `/chunks/:slug`. |
| **Episode** | One issue of the newsletter, dated. Contains chunks. Either "essays" format (few long chunks) or "notes" format (many short chunks). |
| **Topic** | A concept that recurs across the corpus. Replaces "tag" and "concordance word". Has a name, a slug, usage data, distinctiveness score, temporal profile, and co-occurring topics. Displayed at `/topics/:slug`. |
| **Entity** | A proper noun topic — a person, product, or organization. A subtype of topic identified by capitalization heuristics and multi-word extraction. |

Terms we no longer use: "tag" (in UI and comments), "observation" (use "chunk"), "concordance" (as a user-facing concept — the underlying data tables remain).

## Data model

### Table renames

Every table is renamed to match the new language:

| Old name | New name | Reason |
|----------|----------|--------|
| `tags` | `topics` | The core entity |
| `chunk_tags` | `chunk_topics` | Junction table |
| `episode_tags` | `episode_topics` | Junction table |
| `concordance` | `word_stats` | What it actually contains — per-word corpus statistics |
| `chunk_words` | `chunk_words` | Already correct |

The migration recreates these tables (D1 doesn't support `ALTER TABLE RENAME`). Data is copied from old to new, old tables dropped.

### Schema changes

**`topics` table** (formerly `tags`):

```sql
CREATE TABLE topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'concept',  -- 'concept' | 'entity' | 'phrase'
  usage_count INTEGER NOT NULL DEFAULT 0,
  distinctiveness REAL NOT NULL DEFAULT 0,
  related_slugs TEXT  -- JSON array of co-occurring topic slugs, precomputed
);
```

**`word_stats` table** (formerly `concordance`):

```sql
CREATE TABLE word_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  total_count INTEGER NOT NULL DEFAULT 0,
  doc_count INTEGER NOT NULL DEFAULT 0,
  distinctiveness REAL NOT NULL DEFAULT 0,
  in_baseline INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Remove the 5-tag cap** in `extractTags()`. Currently chunks are bandwidth-constrained — 94% hit the ceiling. Topics should reflect all significant concepts in a chunk.

**Merge split concepts** during enrichment. Co-occurrence data reveals pairs that are single ideas:

| Tag 1 | Tag 2 | Co-occurrences | Merged topic |
|-------|-------|---------------|-------------|
| prompt | injection | 17 | prompt injection |
| cognitive | labor | 15 | cognitive labor |
| coding | vibe | 20 | vibe coding |
| resonant | hollow | 14 | resonant + hollow |
| agent | swarm | 14 | agent swarm |
| tech | industry | 13 | tech industry |

These merges happen in the enrichment pipeline, not at query time.

## Pages

### `/topics` — The index

The entry point for understanding the corpus. Three sections:

**1. Small multiples grid (top 20 topics)**

A 4×5 grid of sparklines, all sharing the same x-axis (corpus timeline) and y-axis (normalized frequency). Each cell shows:
- Topic name
- Tiny sparkline (SVG, ~120×40px)
- Total count

This is Tufte's most powerful technique for comparison. The eye instantly sees: which topics are rising (agent), which peaked and faded (context), which are steady (llms). Pure server-rendered SVG, no JS.

**2. ThemeRiver**

A stacked area chart where each stream represents one of the top 10-15 topics over time. The x-axis is weekly episodes. The total height represents corpus volume. Each colored stream shows a topic's share of attention.

This reveals what no other visualization can: the *composition* of the newsletter's focus over time. When one topic swells, you can see what it displaces.

Implementation: compute stacked y-values server-side, emit SVG `<path>` elements with `fill` colors derived from the accent palette. Label each stream inline (Tufte: label data directly, not in a legend).

**3. Entity tier**

A section for people, products, and organizations — the multi-word proper noun topics. Rendered as a compact list (not a cloud), grouped:

```
People: Simon Willison · Sam Altman · Ben Thompson
Products: Claude Code · ChatGPT · Hacker News
Concepts: Goodhart's Law · Coasian Floor · pace layers
```

**4. Topic search**

Client-side filter (already exists for tags, reuse the pattern).

### `/topics/:slug` — Topic detail

The merged page that replaces both `/tags/:slug` and `/concordance/:word`.

**Header**

```
LLMs
1,036 mentions · 710 chunks · 52 episodes
Distinctiveness: 113.6× baseline
```

Mention count from concordance. Chunk count from chunk_tags. Episode count from episode_tags. Distinctiveness from concordance scoring.

**Dispersion plot**

A barcode-style visualization: one thin vertical mark for each episode in the corpus. Filled marks where the topic appears, empty space where it doesn't. This shows *distribution* — clusters of attention and periods of silence — which is more informative than a sparkline (which shows magnitude but not gaps).

Implementation: a single SVG row, width = number of episodes, each mark is a `<rect>` of 2-3px width. Color intensity can encode frequency (light = 1 mention, dark = 10+).

**Slopegraph**

A year-over-year comparison showing this topic's rank among all topics. Left column: rank in the earlier year. Right column: rank in the later year. A line connects them. Rising = topic gaining prominence. Falling = topic fading.

Only shown for topics with enough data across multiple years.

**Related topics**

From precomputed co-occurrence data. "Often appears with: software · code · chatbot · agent · model." Each is a link to its topic page.

**KWIC (Key Word In Context)**

From corpus linguistics. A table where the keyword is center-aligned in a fixed column, with left context right-aligned and right context left-aligned. All in monospace. This reveals patterns invisible in running text:

```
          the future of │ LLMs │ is agents that can...
        applied naively │ LLMs │ just turn the crank...
          fine-tuning   │ LLMs │ on proprietary data is...
    the fundamental bet │ LLMs │ make is that patterns...
```

The vertical alignment lets the eye scan what *surrounds* the topic — the discourse frame. Rendered as an HTML `<table>` with three `<td>` columns.

**Episodes (density bars)**

Keep the existing episode density bars from the tag detail page. Show which episodes discuss this topic most, with horizontal bars proportional to chunk count.

**Evolution over time (collapsible)**

Keep the existing collapsible diff view showing chunks in chronological order.

**Chunks with highlighted excerpts**

Paginated chunk list. Each chunk shows an excerpt with the topic name highlighted (`<mark>`). This comes from the concordance highlighting, applied to the tag-based chunk list.

### Episode pages — Topic marginalia

Episodes currently show tag pills in a collapsible sidebar. Replace with topic marginalia:

**Desktop (≥769px):** Topics float in the right margin, Tufte-style. Two groups:

```
                                    │ Topics
                                    │ llms · agent · coding
                                    │ swarm · ecosystem
                                    │
                                    │ Trending ↑
                                    │ agent (+5.4× this quarter)
```

The "Trending" section shows topics that are spiking in this episode relative to their corpus average. Computed during enrichment.

**Mobile (<769px):** Collapses to a `<details>` accordion below content (same as current behavior).

### Chunk detail pages — Topic marginalia

Same treatment. Topics in the margin alongside the existing "Related chunks" margin notes. Two types of marginalia, clearly separated:

```
  The future of LLMs is agents     │ Topics
  that can orchestrate other       │ llms · agent · swarm
  models to accomplish complex     │
  tasks...                         │ Related chunks
                                   │ Agents changing
                                   │ themselves each loop
                                   │ 2025-11-03
```

### `/search` — Topic highlighting

Search results already show `<mark>` highlighting. No change needed — the topics system inherits this.

## Navigation

```
Header: Bobbin  Episodes  Topics  Search(icon)
```

"Concordance" is removed from the nav. "Tags" becomes "Topics".

## Implementation phases

### Phase 1: Language cleanup + table renames

Rename throughout the codebase — code, SQL, types, UI text, CSS classes:

- Tables: `tags` → `topics`, `chunk_tags` → `chunk_topics`, `episode_tags` → `episode_topics`, `concordance` → `word_stats`
- Types: `TagRow` → `TopicRow`, `ConcordanceRow` → `WordStatsRow`
- Functions: `getEpisodeTags` → `getEpisodeTopics`, `getChunkTags` → `getChunkTopics`, etc.
- Components: `TagCloud` → `TopicCloud`
- CSS: `.tag-*` → `.topic-*`, `.concordance-*` → topic detail styles
- Routes: `/tags` → `/topics`, remove `/concordance`
- Nav: "Tags" → "Topics", remove "Concordance"
- All comments and test descriptions

Migration creates new tables, copies data, drops old tables. Tests and test helpers update to match.

### Phase 2: Merge topic + word_stats data on topic detail page

Enrich `/topics/:slug` with:
- Word stats (mention count, distinctiveness) in the header — from `word_stats` table
- Highlighted excerpts in the chunk list — from `chunk_words` data
- Related topics — from co-occurrence query on `chunk_topics`

The two-source merge: look up the topic in `topics` (by slug) and `word_stats` (by name). Display whichever data exists.

### Phase 3: Dispersion plot + KWIC

Add to the topic detail page:
- Dispersion plot: SVG barcode from `getTagSparkline` data
- KWIC display: query `chunk_words` to find chunks containing the word, extract surrounding context, render center-aligned table

### Phase 4: Small multiples index

Replace the tag cloud / concordance bar chart with:
- 4×5 sparkline grid of top 20 topics
- Entity tier (people, products, concepts)
- Topic search

### Phase 5: Topic marginalia

Replace tag pills on episode and chunk detail pages with topic marginalia:
- Desktop: Tufte margin notes
- Mobile: collapsible details
- Show "trending" indicator for topics spiking in this episode

### Phase 6: ThemeRiver + Slopegraph

Advanced visualizations on the topics index:
- ThemeRiver: stacked area SVG showing topic composition over time
- Slopegraph: year-over-year ranking comparison for individual topic pages

### Phase 7: Entity detection overhaul

The current capitalization-heuristic detector misses major entities. OpenAI appears in 68 chunks but has zero topic assignments. The 5-tag cap means even detected entities get crowded out.

Three layers, each reinforcing the others:

**Layer 1: Curated entity list.** A `src/data/known-entities.ts` file mapping names to kinds:

```ts
export const KNOWN_ENTITIES: { name: string; kind: "person" | "company" | "product"; aliases?: string[] }[] = [
  { name: "OpenAI", kind: "company", aliases: ["openai"] },
  { name: "Google", kind: "company", aliases: ["google", "alphabet"] },
  { name: "Anthropic", kind: "company" },
  { name: "Meta", kind: "company" },
  { name: "Microsoft", kind: "company" },
  { name: "Apple", kind: "company" },
  { name: "Simon Willison", kind: "person", aliases: ["willison"] },
  { name: "Ben Thompson", kind: "person", aliases: ["stratechery"] },
  { name: "Sam Altman", kind: "person", aliases: ["altman"] },
  { name: "Andrej Karpathy", kind: "person", aliases: ["karpathy"] },
  { name: "Ethan Mollick", kind: "person", aliases: ["mollick"] },
  { name: "Claude Code", kind: "product" },
  { name: "ChatGPT", kind: "product", aliases: ["chatgpt"] },
  { name: "Hacker News", kind: "product", aliases: ["hackernews", "hn"] },
  // ~50-100 entries, curated from corpus data
];
```

During enrichment, check every chunk against this list via case-insensitive substring match. Matches bypass the TF-IDF scoring — if the text mentions "OpenAI", it gets the topic. No cap.

**Layer 2: AI-powered extraction.** Use `env.AI` during Phase 2 enrichment (background, not on the hot path) to extract entities the curated list misses:

```ts
const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{
    role: "user",
    content: `Extract people, companies, and products mentioned in this text. Return JSON: {"people":[],"companies":[],"products":[]}. Only include proper nouns, not generic concepts.\n\n${chunk.content_plain}`
  }]
});
```

This catches long-tail entities (one-off mentions of researchers, niche products) that aren't worth curating. Results are merged with curated matches — curated list is authoritative, AI fills gaps.

**Layer 3: Distinctiveness-backed promotion.** Words in `word_stats` with high distinctiveness (>15) that aren't in the English baseline and appear with consistent capitalization in the source text are entity candidates. During enrichment, cross-reference:
- `word_stats.distinctiveness >= 15`
- `word_stats.in_baseline = 0`
- Capitalized in >50% of occurrences in chunk text

Auto-promote these to topics with `kind = 'entity'`. This catches corpus-specific terms like "stratechery", "substack", "vercel" that are clearly entities but might not be in the curated list or recognized by the AI.

**Coreference.** The curated list's `aliases` field handles known coreferences: "Stratechery" and "Ben Thompson" merge to the same topic. The AI layer can be prompted to resolve coreferences too ("If the text mentions 'Thompson' in context of tech analysis, that's Ben Thompson").

### Phase 8: Enrichment pipeline improvements

- Remove 5-tag cap in `extractTags()` — topics should reflect all significant concepts
- Auto-merge split concepts based on co-occurrence data (prompt+injection → prompt injection)
- Precompute `related_slugs` and `distinctiveness` on the `topics` table
- Re-ingest to populate all new data with the three-layer entity detection

### Phase 9: Topic-aware search

The current search (FTS5 + Vectorize) operates on raw text only. It doesn't know about topics. Three improvements:

**Topic boost.** When a search query matches a topic name, boost chunks that have that topic assigned — not just chunks containing the literal string. Searching "agents" should also surface chunks about "autonomous AI" that are tagged with the agent topic but use different words.

Implementation: after FTS5 + Vectorize results are merged, check if the query matches a topic slug. If so, query `chunk_topics` for that topic's chunks and apply a score bonus (+0.15) to any result that appears in both the text search and the topic assignment. This rewards chunks where the concept is thematically central, not just mentioned in passing.

**Entity alias expansion.** When a search query matches a known entity or alias, expand the search to include all aliases. Searching "Stratechery" also matches chunks tagged with "Ben Thompson" (and vice versa). Searching "OpenAI" also matches chunks mentioning "Sam Altman" if the curated list links them.

Implementation: in `parseSearchQuery()`, check the query text against `KNOWN_ENTITIES` aliases. If matched, add the canonical name and all aliases as additional FTS5 OR terms. This is query-time expansion — no index changes needed.

**`topic:` search operator.** Add to the existing operator set (`before:`, `after:`, `year:`). Examples:

```
agents topic:coding     → chunks about agents in the context of coding
topic:openai            → all chunks assigned the OpenAI topic
LLMs topic:ecosystem    → LLM mentions filtered to ecosystem-related chunks
```

Implementation: extend `ParsedQuery` with `topics?: string[]`. In the search route, resolve topic slugs to IDs, then add `AND c.id IN (SELECT chunk_id FROM chunk_topics WHERE topic_id = ?)` to the FTS5 query's WHERE clause. This acts as a facet filter on top of text search.

## What gets deleted

| Current | Becomes |
|---------|---------|
| `src/routes/tags.tsx` | `src/routes/topics.tsx` |
| `src/routes/concordance.tsx` | Deleted — merged into `topics.tsx` |
| `src/db/tags.ts` | `src/db/topics.ts` |
| `src/db/concordance.ts` | `src/db/word-stats.ts` (word queries) + `src/db/chunks.ts` (getMostConnected) |
| `src/components/TagCloud.tsx` | `src/components/TopicCloud.tsx` |
| `src/services/tag-generator.ts` | `src/services/topic-extractor.ts` |
| `src/types.ts: TagRow` | `TopicRow` (with `kind`, `distinctiveness`, `related_slugs`) |
| `src/types.ts: ConcordanceRow` | `WordStatsRow` |
| `test/helpers/migrations.ts` | Updated table names |
| All `.tag-*` CSS classes | `.topic-*` |
| All `.concordance-*` CSS classes | Replaced by topic detail page styles |
| `tags` table | `topics` table |
| `chunk_tags` table | `chunk_topics` table |
| `episode_tags` table | `episode_topics` table |
| `concordance` table | `word_stats` table |

## What the data audit tells us

The 20 strongest topic candidates (dual-validated by both tag usage and concordance distinctiveness):

| Topic | Tag uses | Distinctiveness | Character |
|-------|----------|----------------|-----------|
| llms | 646 | 113.6 | Meta-topic: the dominant subject |
| infinite | 78 | 37.8 | Komoroske's "infinite software" thesis |
| chatgpt | 101 | 27.6 | Product |
| emergent | 70 | 36.5 | Systems thinking frame |
| claude | 69 | 30.5 | Product |
| swarm | 58 | 27.9 | Agent architecture pattern |
| resonant | 59 | 22.4 | Komoroske's resonant/hollow framework |
| ecosystem | 42 | 26.0 | Platform dynamics frame |
| vibe | 51 | 19.7 | Vibe coding cultural moment |
| hollow | 39 | 18.7 | Paired with resonant |
| slop | 32 | 19.4 | AI-generated low-quality content |
| leverage | 27 | 23.0 | Strategic frame |
| coding | 38 | 19.8 | Often paired with "vibe" |
| collective | 38 | 25.4 | Collective intelligence |
| prompt | 36 | 26.8 | Often paired with "injection" |

These are the seeds. The topics system grows from here.
