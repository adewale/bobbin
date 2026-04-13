Enrichment Pipeline v2: Results

> **Historical snapshot (2026-04-12).** This document records the state of the pipeline at the time v2 was deployed. Metrics reflect the database at that point and may not match current values.

## Before/After Metrics

| Metric | Before (v1) | After (v2) | Change |
|--------|-------------|------------|--------|
| Top 20: noise words | 13/20 (65%) | 1/20 (5%) | 12x cleaner |
| Top 20: entities | 2/20 | 4/20 | 2x more |
| Top 20: phrases | 0/20 | 9/20 | From zero to dominant |
| Entity-kind topics | 1 | 26 | 26x more |
| chunk_topics | 64,954 | 59,645 | 8% less noise |
| Topics usage=1 | 6,831 | 6,379 | 7% reduction |
| IDF scoring | Dead code | Active | Now functional |

## Topics grid: before

```
llms, system, software, model, hacker news, data, value, context,
agent, require, tool, code, power, product, matter, allow, infinite,
emergent, tech, claude
```

13 generic noise words. 0 phrases. 2 entities.

## Topics grid: after

```
hacker news, geoffrey litt, resonant, infinite software, claude code,
vibe coding, emergent, social media, cognitive labor, prompt injection,
disconfirming evidence, resonance, chatgpt, consistent bias,
quantitative scale, chatbot, meta, mental model, tech industry, llms
```

9 phrase topics. 4 entities. 0 generic noise words (except geoffrey litt data issue).

## What v2 fixed

1. IDF scoring now active — extractTopics receives corpus stats
2. Noise filter at insert time — garbage never enters chunk_topics
3. HTML entities decoded consistently — extractKnownEntities and extractEntities get clean text
4. tokenizeForWordStats decodes HTML entities
5. Per-chunk bigrams removed (corpus n-grams are strictly better)
6. Entity kind set during enrichment (UPDATE fallback for INSERT OR IGNORE conflicts)
7. Expanded NOISE_WORDS: ~100 entries covering generic nouns, verbs, adjectives
8. Known entities expanded: +4 people, fixed short alias "litt"

## Known remaining issues

1. Geoffrey Litt over-counted (157 uses) — old data from "litt" substring alias
2. "infinite" still standalone (124 uses) — n-gram finalization timed out
3. Finalization too heavy for HTTP — needs background task or chunking
4. 6,379 topics with usage=1 — long tail bloat
5. 14 chunks still unenriched
6. Some noise words ("context", "agent") still in DB from pre-filter data
