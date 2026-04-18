# Source Fidelity Preservation Plan

## Goal

Bobbin currently ingests Alex Komoroske's Google Docs into a mostly plain-text representation. That is good enough for topic extraction, but not good enough for preserving source fidelity.

The goal of this plan is to preserve and eventually surface the most valuable source-level semantics:

- links
- text formatting
- nesting levels
- images
- superscript
- unordered lists and list-style semantics
- explicit separators like `<hr>`
- strikethrough
- other real source artifacts that appear in the corpus

The key design principle is:

- keep raw HTML as the original source of truth
- add a structured parsed representation that preserves fidelity
- derive plain text / normalized text from that structured representation for downstream pipeline work

## Current fidelity profile

Current pipeline fidelity is:

- high for plain text
- medium for chunk grouping
- low for inline semantics

What we preserve reasonably well today:

- episode boundaries
- chunk boundaries
- plain text content
- first-sentence chunk titles

What we currently lose:

- inline links
- text formatting (bold / italic / underline)
- exact nesting depth beyond "main line + subpoints"
- chunk-level anchors / source anchors
- non-text structural artifacts such as images
- superscript / strikethrough / line-break semantics

## Corpus reality: non-zero fidelity features

These counts are from the cached `data/raw/*.html` corpus.

### Core requested fidelity features

| Feature | Count | Notes |
|---|---:|---|
| Inline links (`<a href=...>`) | 3904 | Highest-value missing feature |
| Bold style (`font-weight:700`) | 86 | Appears as inline style, not semantic tags |
| Italic style (`font-style:italic`) | 986 | Common |
| Underline style (`text-decoration:underline`) | 1160 | Often overlaps links |
| Nesting level 72pt | 16802 | Very common second-level structure |
| Nesting level 108pt | 3367 | Common third-level structure |
| Nesting level 144pt | 164 | Rare but real deeper nesting |
| Nesting level 180pt | 5 | Very rare, but present |

### Other fidelity features with non-zero instances

| Feature | Count | Notes |
|---|---:|---|
| Images (`<img>`) | 6 | Real media loss today |
| Superscript (`<sup>`) | 1371 | Common and fully lost today |
| Strikethrough (`text-decoration:line-through`) | 2 | Rare, but present |
| Background colors | 108 | Could represent highlight/callout semantics |
| Non-default text colors | 203 | Some may be stylistic, some semantic |
| Non-default font sizes | 176 | Reflect heading/visual hierarchy |
| Unordered lists (`<ul>`) | 13906 | Current parser flattens semantic list structure |
| Explicit list-style declarations | 319 | May encode bullet/number/list-type differences |
| `<br>` tags | 32 | Explicit line-break semantics currently flattened |
| `<hr>` tags | 18 | Page/separator structure |
| Page breaks | 13 | Not currently surfaced |

## Prioritization

### Tier 1: preserve immediately

These have the highest value for user-facing fidelity and future enrichment quality.

1. Links
2. Nesting levels and list structure
3. Inline formatting: bold, italic, underline
4. Unordered lists and list-style semantics

### Tier 2: preserve in structured form, surface later

These are real and should not be thrown away, but they are less critical for the first UI pass.

1. Superscript
2. Images
3. `<br>` line breaks
4. Strikethrough
5. `<hr>` separators

### Tier 3: preserve if cheap, but do not block rollout

These may matter, but they are lower leverage initially.

1. Background colors / highlights
2. Non-default text colors
3. Non-default font sizes
4. Page breaks / horizontal rules

## Storage model

### Keep raw HTML

Persist raw source HTML exactly as fetched.

Why:

- canonical source of truth
- needed for parser improvements
- needed to recover lost semantics later

### Add structured rich-text artifacts

For each episode/chunk, persist a structured representation instead of only flattened text.

Suggested shape:

```json
{
  "blocks": [
    {
      "type": "list_item",
      "depth": 0,
      "children": [
        {"type": "text", "text": "Prompt injection attack"},
        {"type": "text", "text": " matters", "italic": true},
        {"type": "link", "text": "article", "href": "https://..."}
      ]
    }
  ]
}
```

This should preserve:

- ordered block sequence
- per-item depth
- inline spans
- links with href + anchor text
- line breaks where meaningful
- list type / bullet semantics where present
- image references
- separators

Suggested block/span types:

- block types:
  - `paragraph`
  - `list_item`
  - `image`
  - `separator`
- span types / annotations:
  - `text`
  - `link`
  - `bold`
  - `italic`
  - `underline`
  - `strikethrough`
  - `superscript`

Suggested extra block fields:

- `depth`
- `listStyle`
- `href`
- `src`
- `alt`
- `breakAfter`

### Keep derived plain text

Still derive:

- `content_plain`
- `analysis_text`

Those remain the source of truth for normalization, tokenization, ranking, and promotion logic.

## Parsing plan

### Step 1: parse HTML to rich blocks

Replace current tag-stripping-only parsing with a two-layer parse:

1. rich block extraction
2. plain-text derivation from rich blocks

The parser should preserve, per chunk:

- block order
- list nesting depth (`36pt`, `72pt`, `108pt`, `144pt`, `180pt`)
- unordered list membership
- explicit list-style/bullet semantics
- inline links
- inline formatting spans
- superscript spans
- strikethrough spans
- explicit line breaks
- image references
- separators (`<hr>`, page-break boundaries)

### Step 2: derive plain-text chunk content from rich blocks

Rules:

- links contribute anchor text to plain text
- formatting does not change plain text, only annotations
- nesting contributes to structure, not duplicate text
- line breaks remain explicit where they separate subpoints or semantic lines
- superscript contributes plain text but also keeps annotation
- images do not disappear: they become image blocks plus optional placeholder text in plain derivation if needed
- separators do not inject arbitrary prose into plain text, but remain as structural markers

### Step 3: derive optional Markdown

Canonical Markdown can be generated from the rich structured representation, not directly from raw HTML.

Markdown is useful as:

- human-readable intermediate artifact
- golden fixture material
- debugging export

But raw HTML must still be kept.

## UI plan

### Phase 1: preserve only

Persist but do not fully render all fidelity features yet.

Must surface immediately:

- links
- list nesting
- basic inline formatting (`bold`, `italic`, `underline`)
- unordered list structure
- explicit list-style differences where discernible

Can remain hidden but preserved initially:

- images
- superscript
- strikethrough
- line-break metadata if not visually rendered yet
- separators (`<hr>`, page breaks)

### Phase 2: render on chunk and episode pages

Chunk/episode rendering should use the rich representation instead of only `content_plain`.

That means:

- real anchor tags in content
- nested list indentation
- inline emphasis
- preserved line breaks
- superscript rendering
- strikethrough rendering
- images rendered inline or as linked figures
- separators rendered as visual rule breaks where appropriate

### Phase 2b: mobile rendering requirements

All preserved fidelity features must be rendered intentionally on mobile, not just desktop.

Mobile requirements:

- links:
  - remain tappable
  - preserve visible distinction from body text
- nesting:
  - reduced-indent list layout that still preserves depth
  - no horizontal overflow from deep nesting
- unordered list and list-style semantics:
  - bullets/numbers remain visually distinct at small widths
- formatting:
  - bold/italic/underline/superscript/strikethrough remain legible at mobile font sizes
- images:
  - scale to container width
  - preserve aspect ratio
  - support tap-through to original source if inline rendering is too large
- separators:
  - rendered as spacing + rule without collapsing content rhythm

Mobile should not flatten fidelity back to plain text. Preservation only matters if the mobile UI also reflects it.

### Phase 3: source-aware navigation

Eventually add:

- source anchors / heading ids per chunk where possible
- source-link previews or "open original source" links

## How each preserved feature should travel through the pipeline

### Links

- ingest: parse `href`, anchor text, and chunk ownership
- storage: persist inline link spans and extracted link metadata
- downstream: LLM/entity/topic enrichment can use linked text as supporting evidence
- UI: render anchor text as clickable links on desktop and mobile

### Bold / italic / underline

- ingest: preserve as inline span annotations
- storage: persist span attributes in rich content
- downstream: optional soft salience signals, but not source of truth
- UI: render emphasis faithfully on desktop and mobile

### Nesting levels

- ingest: preserve exact list depth per block
- storage: persist `depth`
- downstream: help distinguish main assertions from subpoints
- UI: render nested list hierarchy responsively, including on mobile

### Unordered lists / list-style declarations

- ingest: preserve whether a block is in a list and any available bullet/list-style hints
- storage: persist `listStyle`
- downstream: improve structure-aware chunk/LLM context
- UI: render bullets/list semantics explicitly instead of plain paragraphs

### Images

- ingest: preserve `src`, `alt`, and chunk/episode association
- storage: persist image blocks in rich content
- downstream: available for future multimodal enrichment, but not required for initial topic pipeline
- UI: render inline where sensible, with mobile-safe scaling and source links

### Superscript

- ingest: preserve superscript spans
- storage: persist as span annotation
- downstream: included in plain text but marked as superscript in rich content
- UI: render as superscript on desktop and mobile

### Strikethrough

- ingest: preserve strikethrough spans
- storage: persist as span annotation
- downstream: usually ignored for topic extraction but kept for fidelity
- UI: render with line-through styling

### Explicit line breaks

- ingest: preserve `<br>` as meaningful break markers
- storage: persist line-break markers in rich content
- downstream: can inform title extraction and subpoint semantics
- UI: render line breaks intentionally instead of collapsing them

### Separators (`<hr>`, page breaks)

- ingest: preserve as structural separator blocks
- storage: persist `separator` blocks with optional page-break metadata
- downstream: can help identify section boundaries or non-content splits
- UI: render as horizontal rules / section breaks on desktop and mobile

## LLM-at-ingest interaction

The LLM-at-ingest proposal layer should use the rich parsed representation as context if helpful, but the deterministic downstream pipeline should still operate over normalized text and verified evidence.

Important interactions:

- links can become extra evidence for entity/topic proposals
- formatting can act as a soft salience signal
- nesting can help distinguish main ideas from subordinate detail

But:

- downstream validation must still be text/evidence-based, not style-based alone

## Metrics

### Preservation metrics

- percent of source links preserved into chunk artifacts
- percent of preserved links rendered in UI
- percent of nested list items with correct depth preserved
- percent of italic/bold/underline spans preserved
- images preserved count
- superscript preserved count

### Quality metrics

- chunk render fidelity spot checks
- broken-link rate after preservation
- parser regression golden tests on representative docs
- audit count of "anchor text preserved but href lost" should go to zero

### Product metrics

- user-visible links per chunk / episode
- chunks with nested content rendered faithfully
- chunks with formatting spans rendered faithfully

## Acceptance criteria

The first fidelity rollout is successful if:

1. Inline links are preserved with href + anchor text and rendered on the web pages.
2. Nesting depth is preserved at least through 180pt depth and rendered on chunk pages.
3. Bold / italic / underline are preserved and rendered.
4. Unordered list semantics and list-style hints are preserved and rendered.
5. Images, superscript, strikethrough, and separators are preserved in storage even if some are staged behind later UI rollout.
4. Plain-text normalization and downstream topic extraction remain stable.
5. Existing chunking semantics do not regress.
6. Raw HTML remains available as the original source of truth.

## Recommended implementation order

1. Add rich chunk/episode artifact schema
2. Preserve links in parser output
3. Preserve nesting depth and list structure
4. Preserve bold/italic/underline spans
5. Preserve images / superscript / strikethrough / explicit breaks / separators in parser output
6. Update renderers to consume rich content on desktop and mobile
7. Add golden tests for representative source docs

## Testing strategy

This plan should be implemented with explicit testing best practices.

### Red-Green TDD order

Recommended order:

1. failing parser tests for preserved rich blocks
2. failing derivation tests for plain-text projection
3. failing rendering tests for desktop and mobile
4. golden tests for representative source documents
5. characterization checks against the current parser so chunking does not silently regress

### Golden fixture tests

Golden fixtures are essential here.

For representative docs/chunks, snapshot:

- rich JSON output
- derived plain text
- optional Markdown output if Markdown is added

Goldens should verify preservation of:

- links
- nesting depth
- list semantics
- formatting spans
- images
- superscript / strikethrough
- separators / line breaks

### Property-based tests

Add PBT for preservation invariants.

Recommended invariants:

- every preserved link keeps both href and anchor text
- derived plain text is a lossless text projection of rich content
- nesting depth is non-negative
- formatting annotations never alter plain-text token content
- Markdown generation (if added) is idempotent
- preserved rich content never produces malformed renderer output

### Characterization tests

Compare old parser vs new parser on the full real corpus.

Track:

- episode count
- chunk count
- chunk title stability
- chunk content stability
- preserved-link counts
- preserved-formatting counts
- preserved-nesting counts

The parser is only successful if fidelity improves without silently breaking chunking.

### Rendering tests

Required route/render coverage:

- chunk page renders links correctly
- chunk and episode pages render nested lists correctly
- desktop and mobile render preserved formatting correctly
- images do not overflow mobile layouts
- separators and explicit breaks do not collapse reading rhythm

### Failure-path tests

Required coverage for:

- malformed HTML
- partially formatted spans
- missing hrefs / empty anchors
- broken nesting order
- images without alt text
- unexpected inline style combinations

### Rollout success thresholds

Do not ship source-fidelity changes unless they:

- preserve 100% of links with href + anchor text in stored artifacts
- preserve observed nesting depths through the max seen in corpus samples
- preserve formatting spans in storage without changing plain-text semantics
- render correctly on desktop and mobile for golden fixtures
- do not regress episode/chunk counts or downstream topic extraction quality
