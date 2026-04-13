Enrichment v3: Self-Healing Fixes — Before/After

> **Historical snapshot (2026-04-12).** This document records the state of the pipeline at the time v3 self-healing was deployed. Metrics reflect the database at that point and may not match current values.

## Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Geoffrey Litt chunk_topics | 157 | **7** | Fixed: 150 false matches removed |
| Noise-word chunk_topics | 1,431 | **0** | All noise assignments deleted |
| Topics with usage > 0 | 12,443 | **6,044** | 51% reduction (noise pruned) |
| Total chunk_topics | 59,645 | **51,319** | 14% reduction |
| Phrase topics (usage>0) | 1 | 1 | Same (n-gram finalization still needs full run) |

## Topics grid: after v3

```
resonant, infinite software, claude code, vibe coding, emergent,
social media, cognitive labor, prompt injection, disconfirming evidence,
resonance, consistent bias, quantitative scale, chatgpt, chatbot,
mental model, tech industry, llms, meta, emerge, alignment
```

- 0 noise words (was 13 in v1)
- 8 phrase topics in the grid
- 2 entities (chatgpt, meta)
- Geoffrey Litt no longer in top 20 (was #4 with 157 false matches)

## Self-healing steps (run automatically every cron)

1. **Entity validation** — for each entity topic, delete chunk_topics where chunk doesn't contain the entity name. Catches future alias matching bugs.

2. **Noise cleanup** — delete chunk_topics and episode_topics for any topic matching NOISE_WORDS. If new words are added to the list, they're cleaned on the next run.

3. **Usage recalculation** — recalculate usage_count from actual chunk_topics after all cleanup.

4. **Usage=1 prune** — zero out topics with usage <= 1. These are single-occurrence words with no navigational value.

5. **enrichAllChunks** — loops with time budget and infinite-loop detection. Catches any chunks missed by batch limits.

## What's still not self-healing

- **Phrase topics (n-gram extraction)** — the full finalization (including n-gram extraction) still times out via HTTP. Once moved to cron (15 min budget on paid plan), this will run automatically and discover phrase topics.

- **Related slugs** — same timeout issue. Will self-heal once finalization runs in cron.
