# Popular Topics & Entity/Topic Detection Audit

**Date:** 2026-04-12
**Database:** bobbin-db (remote), 5,639 chunks, 6,042 active topics

---

## 1. Popular Topics Correctness

### Ranking Formula
`getTopTopics()` sorts by `usage_count * CASE WHEN distinctiveness > 0 THEN distinctiveness WHEN name LIKE '% %' THEN 20 ELSE 1 END`, filters `usage_count >= 3`, then removes noise words via `isNoiseTopic()`.

### Top 10 displayed (by sort_score):
| Topic | Usage | Distinctiveness | Score | Kind |
|-------|-------|-----------------|-------|------|
| llms | 659 | 113.6 | 74,862 | concept |
| claude | 151 | 30.5 | 4,606 | entity |
| emergent | 116 | 36.5 | 4,234 | concept |
| chatgpt | 129 | 27.6 | 3,560 | entity |
| swarm | 97 | 27.9 | 2,706 | concept |
| chatbot | 106 | 19.2 | 2,035 | concept |
| prompt | 75 | 26.8 | 2,010 | concept |
| collective | 74 | 25.4 | 1,880 | concept |
| ecosystem | 71 | 26.0 | 1,846 | concept |
| resonant | 77 | 22.4 | 1,725 | concept |

### usage_count vs actual chunk_topics count
**All 10 match exactly.** For every topic tested, `usage_count` equals `COUNT(*) FROM chunk_topics`. The denormalized counter is perfectly accurate.

### Topics that SHOULD be popular but are missing
Comparing raw chunk_topics count (top 20 by raw count) vs. Popular Topics display:

These topics are high by raw count but correctly suppressed:
- **google** (86) -- low distinctiveness (0.49), ranks low in sort score
- **insight** (85) -- low distinctiveness (2.12), not distinctive enough
- **game** (84), **lead** (81), **love** (78), **wrong** (77), **grow** (77), **social** (77), **focus** (75) -- all have distinctiveness < 2, so their sort scores are low (< 170)

**Verdict: The ranking formula works well.** The `usage_count * distinctiveness` formula correctly promotes domain-specific terms (llms, emergent, swarm, chatbot) over common English words (game, lead, love, wrong). No genuinely important topics are being incorrectly suppressed.

### One concern: "prompt" subsumption
"prompt" (usage=75, distinctiveness=26.8) appears in the top 10. However, "prompt" is listed in NOISE_WORDS but also has a high sort score. Since `isNoiseTopic()` does not check multi-word phrases, and `curateTopics()` DOES suppress single words subsumed by phrases, the behavior depends on which code path is used:
- `getTopTopics()` uses only `isNoiseTopic()` -- but wait, "prompt" IS NOT actually in NOISE_WORDS. Only "injection" is. So "prompt" correctly appears.
- However, the related `getTopTopicsWithSparklines()` uses the full `curateTopics()` which also checks phrase subsumption. Since "prompt injection" (81) >= 40% of "prompt" (75), "prompt" would be suppressed in that view but not in `getTopTopics()`. This is a minor inconsistency.

---

## 2. Entity Detection Quality

### Entity coverage (all 26 entities in database):
| Entity | Usage Count | Distinctiveness | Status |
|--------|-------------|-----------------|--------|
| claude | 151 | 30.5 | Good |
| chatgpt | 129 | 27.6 | Good |
| google | 86 | 0.49 | Good (low dist. expected - common word) |
| meta | 85 | 12.7 | Good |
| claude code | 77 | 0 | Good |
| OpenAI | 68 | 0 | Good |
| anthropic | 46 | 15.6 | Good |
| apple | 27 | 0.19 | Good (low dist. expected - common word) |
| gemini | 17 | 11.9 | Good |
| cursor | 15 | 11.0 | Good |
| simon willison | 15 | 0 | Good |
| amazon | 13 | 0.07 | Good |
| stratechery | 12 | 11.2 | Good |
| hacker news | 12 | 0 | Good |
| ben follington | 11 | 0 | Good |
| sam altman | 10 | 0 | Good |
| ben thompson | 10 | 0 | Good |
| copilot | 10 | 11.0 | Good |
| microsoft | 9 | 0.03 | Good |
| geoffrey litt | 7 | 0 | Good |
| christopher alexander | 6 | 0 | Good |
| ethan mollick | 3 | 0 | Good |
| jensen huang | 2 | 0 | Good |
| Dario Amodei | 2 | 0 | Good |
| andrej karpathy | 0 | 0 | **ISSUE** |
| tim oreilly | 0 | 0 | **ISSUE** |

### False positives (entities tagged on chunks that don't mention them)
**ZERO false positives found.** Query returned empty results. Entity detection is very precise.

### False negatives (chunks mentioning entities but not tagged)
Tested top 5 entities by usage:
- **OpenAI**: 0 missed (68 mentions, 68 tagged)
- **Google**: 0 missed (86 mentions, 86 tagged)
- **Anthropic**: 0 missed
- **Microsoft**: 0 missed
- **Simon Willison**: 0 missed

**Entity detection has perfect precision and recall for exact name matches.**

### Zero-usage entities
- **andrej karpathy** (0 usage): 4 chunks mention "karpathy" in content. The entity name in the DB is "andrej karpathy" but the alias "karpathy" should match. This suggests the alias matching may not be working for this entity, or the chunks were ingested before the entity was added.
- **tim oreilly** (0 usage): 1 chunk mentions "oreilly"/"o'reilly". Same potential issue.
- **Satya Nadella**: Not in the topics table at all (0 chunks mention "nadella" in content, so this is expected).

**Recommendation:** Re-run entity detection for "andrej karpathy" and "tim oreilly" -- the 4 and 1 chunks containing mentions should be tagged.

---

## 3. Topic Detection Quality (Sample Check)

### Sample 1: "conscientious-feelers-in-the-myers-brigg-sense-are-like-tofu..."
**Content:** About Myers-Briggs Conscientious Feelers absorbing context like tofu.
**Topics:** myer brigg, feeler, myer, tofu, surrounding, absorbed, absorb, ones

**Assessment:** Mixed.
- Good: "myer brigg" captures the concept (though misspelled -- should be "myers-briggs")
- Noise: "ones", "surrounding", "absorbed", "absorb" are generic words, not useful navigational topics
- "tofu" and "feeler" are debatable -- they're content-specific but not useful for cross-chunk navigation

### Sample 2: "someone-told-me-they-used-mcp-in-production..."
**Content:** About using MCP in production with Jira/financial data integrations, security concerns.
**Topics:** jira, asked, safely, financial, file, feedback, told, production, insisted, markdown, image, ticket

**Assessment:** Weak.
- Good: "jira", "production" are relevant
- Missing: "MCP" (the main subject!) is not tagged
- Noise: "asked", "safely", "told", "insisted" are verbs with no navigational value
- "markdown", "image", "ticket" are borderline

### Sample 3: "ads-that-are-aimed-at-convincing-agents..."
**Content:** About ads targeting AI agents being equivalent to prompt injection.
**Topics:** ignore, aimed, instruction, candle, limit, prompt, immediately, convincing, prompt injection

**Assessment:** Mixed.
- Good: "prompt injection" correctly detected
- Good: "prompt" relevant
- Noise: "ignore", "aimed", "candle", "limit", "immediately", "convincing" are not useful topics

**Overall finding:** Topic detection correctly identifies phrase topics and entities, but assigns too many generic single words as concept topics. The NOISE_WORDS filter catches some but many slip through.

---

## 4. Phrase Topic Quality

### 81 phrase topics categorized:

**Good (real concepts, 38 phrases):**
- prompt injection (81), infinite software (65), social media (44), mental model (43), ground truth (40), business model (38), infinite patience (38), vibe coding (38), disconfirming evidence (38), cognitive labor (35), tech industry (35), pace layer (33), consistent bias (28), quantitative scale (28), agent swarm (25), gilded turd (24), resonant computing (24), feedback loop (23), coordination cost (22), exponential cost (21), qualitative nuance (21), mass market (20), network effects (20), goodhart's law (20), silicon valley (18), schelling points (18), injection attack (17), emergent process (16), marginal cost (15), coasian floor (15), sensitive data (15), ooda loop (14), collective intelligence (13), power dynamics (14), revealed preferences (12), early adopters (12), coding agents (11), industrial revolution (5)

**Bad (fragments/noise, 14 phrases):**
- west roundup (19) -- fragment of "wild west roundup"
- lowest common (14) -- fragment of "lowest common denominator"
- queen race (13) -- fragment of "red queen race"
- abundant cognitive (12) -- fragment of "abundant cognitive labor"
- excellent piece (12) -- not a concept, just a compliment
- higher quality (10) -- generic comparative
- vast majority (16) -- filler phrase
- pay attention (15) -- generic phrase
- dead end (17) -- too generic
- ben mathe (5) -- appears to be a name fragment/typo
- broken glass (13) -- too literal/generic
- model quality (14) -- too generic
- model providers (15) -- too generic
- memory feature (11) -- too generic

**Debatable (could go either way, 11 phrases):**
- wild west (25) -- metaphor, somewhat useful
- wild west roundup (19) -- podcast segment name, useful if intentional
- compounding rate (19) -- useful in context
- extremely expensive (18) -- describes a real pattern in AI
- goodhart law (16) -- duplicate of "goodhart's law"
- common denominator (16) -- mostly in "lowest common denominator"
- status quo (15) -- somewhat generic
- pace layers (15) -- plural duplicate of "pace layer"
- deep research (14) -- product name or concept?
- infinite content (14) -- variant of "infinite software"?
- downside risk (13) -- financial/analytical term
- red queen race (13) -- good concept
- writing code (12) -- too generic
- junk food (15) -- metaphor, somewhat useful
- sycosocial relationships (12) -- unique coined term, good
- principal agent (12) -- good economics concept
- infinitely patient (12) -- variant of "infinite patience"?

**Duplicates that should be merged:**
- "goodhart's law" (20) + "goodhart law" (16) = same concept
- "pace layer" (33) + "pace layers" (15) = same concept
- "agent swarm" (25) + "agent swarms" (17) = same concept
- "business model" (38) + "business models" (12) = same concept
- "gilded turd" (24) + "gilded turds" (12) = same concept
- "abundant cognitive" (12) + "abundant cognitive labor" (12) = fragments of same
- "west roundup" (19) + "wild west roundup" (19) = subset/superset
- "queen race" (13) + "red queen race" (13) = subset/superset
- "lowest common" (14) + "common denominator" (16) = fragments of "lowest common denominator"

**Recommendation:** Implement plural normalization and n-gram deduplication. At minimum, merge singular/plural pairs and suppress substring fragments when the full phrase exists.

---

## 5. NOISE_WORDS Accuracy

### Words in NOISE_WORDS that should NOT be there (potentially meaningful):
- **"infinite"** -- In NOISE_WORDS because it's "only meaningful in specific phrases" (infinite software, infinite patience, infinite content). But with usage=0 for standalone "infinite", this is fine. Correct to keep it noise.
- **"vibe"** -- Same reasoning. "vibe coding" is the phrase form. Standalone "vibe" has usage=0. Correct.
- **"injection"** -- Same. "prompt injection" is the phrase. Correct.
- **"coding"** -- Listed as noise; "vibe coding" and "coding agents" are the phrase forms. Standalone "coding" would be too generic. Correct.
- **"signal"** -- Debatable. Could be meaningful in the context of signal vs noise discussions. But probably too generic standalone.

**Verdict: No words in NOISE_WORDS that should be removed.** The list is well-calibrated.

### Words NOT in NOISE_WORDS that should be added:
From the top single-word concepts with usage > 20:

**Strong candidates for NOISE_WORDS (generic, low distinctiveness, no navigational value):**
- "game" (84, dist=0.23) -- too generic
- "lead" (81, dist=0.38) -- verb/generic
- "love" (78, dist=0.20) -- too generic
- "wrong" (77, dist=1.41) -- adjective
- "grow" (77, dist=1.70) -- verb
- "social" (77, dist=0.52) -- too generic (subsumed by "social media")
- "focus" (75, dist=0.79) -- generic verb
- "technology" (74, dist=0.17) -- too generic
- "force" (73, dist=0.53) -- too generic
- "piece" (72, dist=0.79) -- generic noun
- "task" (71, dist=0.54) -- generic noun
- "benefit" (71, dist=0.93) -- generic
- "personal" (71, dist=0.23) -- adjective
- "outcome" (70, dist=1.64) -- generic
- "decision" (70, dist=0.30) -- generic
- "moment" (68, dist=1.35) -- generic
- "ever" (68, dist=0.53) -- adverb/filler
- "together" (67, dist=0.54) -- adverb
- "control" (66, dist=0.19) -- generic
- "conversation" (65, dist=2.69) -- borderline, but too common
- "organization" (64, dist=0.37) -- generic
- "community" (64, dist=0.10) -- generic
- "effect" (64, dist=0.23) -- generic
- "term" (63, dist=0.30) -- generic
- "live" (63, dist=0.17) -- verb
- "dangerous" (62, dist=2.60) -- adjective
- "step" (60, dist=0.41) -- generic
- "word" (59, dist=0.29) -- generic
- "consumer" (59, dist=0.41) -- generic
- "intelligence" (58, dist=1.46) -- subsumed by "collective intelligence"
- "tend" (58, dist=1.76) -- verb
- "realize" (57, dist=2.82) -- verb
- "environment" (57, dist=0.35) -- generic
- "goal" (57, dist=0.62) -- generic
- "energy" (56, dist=0.41) -- generic
- "effort" (54, dist=1.17) -- generic
- "computer" (54, dist=0.10) -- generic
- "situation" (54, dist=0.57) -- generic
- "thought" (54, dist=0.51) -- generic
- "industry" (54, dist=0.17) -- generic
- "brain" (53, dist=0.83) -- generic
- "extremely" (53, dist=2.00) -- adverb
- "entity" (52, dist=1.67) -- generic/meta
- "platform" (52, dist=0.84) -- generic
- "talk" (51, dist=0.33) -- generic
- "structure" (51, dist=0.50) -- generic
- "pull" (51, dist=1.72) -- verb
- "fundamental" (51, dist=1.48) -- adjective
- "practice" (51, dist=0.27) -- generic
- "ability" (51, dist=0.74) -- generic
- "component" (51, dist=0.34) -- generic
- "frame" (51, dist=0.67) -- generic
- "anyone" (50, dist=0.41) -- pronoun
- "magic" (50, dist=0.81) -- generic
- "ones" (50, dist=1.24) -- pronoun

**These 56 words represent topics that consume database space and processing time but provide no navigational value.** All have distinctiveness < 3.0 and are common English words.

**However**, most of these are already correctly suppressed from the Popular Topics display because their low distinctiveness means `usage_count * distinctiveness` produces a low sort score. So adding them to NOISE_WORDS would primarily:
1. Prevent them from appearing on individual chunk topic lists
2. Reduce database clutter (these 56 words account for ~3,500+ chunk_topics rows)
3. Improve topic pages (no one navigates to the "ever" topic page)

---

## Summary of Findings

### What's working well:
1. **Popular Topics ranking is correct.** The `usage_count * distinctiveness` formula effectively promotes domain-specific terms over generic words.
2. **usage_count is perfectly accurate** -- denormalized count matches actual chunk_topics count for all tested topics.
3. **Entity detection has perfect precision** (zero false positives) and **perfect recall** (zero false negatives for all top 5 entities tested).
4. **Phrase topics are mostly good quality** -- 38 out of 81 are genuinely useful concepts.

### Issues found:

1. **NOISE_WORDS is too small.** ~56 high-frequency generic words (game, lead, love, wrong, grow, social, focus, technology, force, piece, task, ever, together, etc.) are not in NOISE_WORDS. While the ranking formula suppresses them from Popular Topics, they still clutter individual chunk topic lists and generate useless topic pages.

2. **Phrase deduplication is missing.** 9 duplicate pairs exist (singular/plural, subset/superset, with/without punctuation). These inflate counts and create confusing duplicate pages.

3. **Two entities have zero usage despite content matches:**
   - "andrej karpathy": 4 chunks mention "karpathy" but 0 are tagged
   - "tim oreilly": 1 chunk mentions the name but 0 are tagged

4. **Chunk-level topic assignment is noisy.** Random sample shows many generic verbs and adjectives being assigned as topics (asked, told, insisted, aimed, ignore, immediately, etc.). The NOISE_WORDS filter only applies at display time, not at ingestion time.

5. **"prompt" topic inconsistency:** Shown in `getTopTopics()` but would be suppressed by `curateTopics()` in sparkline view due to phrase subsumption by "prompt injection".

### Recommendations (priority order):

1. **Expand NOISE_WORDS** with the 56 identified generic words, or better yet, add a distinctiveness threshold (e.g., skip single words with distinctiveness < 3.0).
2. **Implement phrase deduplication** -- normalize plurals and merge substring phrases with their full forms.
3. **Re-run entity detection** for karpathy and oreilly to fix the zero-usage entities.
4. **Apply noise filtering at ingestion time** rather than only at display time, to reduce database bloat.
5. **Unify topic filtering** so `getTopTopics()` and `getTopTopicsWithSparklines()` apply the same curation rules.
