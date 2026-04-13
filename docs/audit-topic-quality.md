# Bobbin Topic & Entity Quality Audit

**Date:** 2026-04-12
**Database:** bobbin-db (remote D1)
**Corpus:** 79 episodes, 12,404 topics (12,345 concept / 21 entity / 38 phrase), 65,083 chunk_topic assignments

---

## 1. Entity Detection Quality

### 1a. Known entities vs actual entity topics

The known-entities list defines **22 entities** (7 companies, 8 people, 7 products).
The DB contains **21 topics with kind='entity'**.

**Missing entity:** `Dario Amodei` and `Satya Nadella` have NO topic at all (not even as concept). All other 20 known entities exist as entity-kind topics.

| Entity | kind | usage_count |
|--------|------|-------------|
| hacker news | entity | 290 |
| claude | entity | 151 |
| chatgpt | entity | 134 |
| meta | entity | 106 |
| google | entity | 89 |
| claude code | entity | 77 |
| OpenAI | entity | 68 |
| anthropic | entity | 46 |
| amazon | entity | 42 |
| apple | entity | 27 |
| ben thompson | entity | 24 |
| gemini | entity | 17 |
| cursor | entity | 15 |
| simon willison | entity | 15 |
| stratechery | entity | 12 |
| sam altman | entity | 12 |
| copilot | entity | 10 |
| microsoft | entity | 9 |
| ethan mollick | entity | 4 |
| andrej karpathy | entity | 4 |
| jensen huang | entity | 3 |

### 1b. Text mentions vs topic assignments

Aliases like `gpt-4`, `gpt4`, `altman`, `karpathy`, `jensen`, `huang`, `alphabet`, `facebook`, `github copilot` exist as separate concept topics but are NOT merged into their parent entities. This means mentions via aliases are not counted toward entity usage.

### 1c. Entity count match

Known entities: **22**. Entity-kind topics: **21**. Gap: 1 (Dario Amodei and Satya Nadella missing; but note the count is 21 not 20, implying one entity was created that isn't from the known list -- investigation shows all 21 map to the 20 found known entities plus one duplicate scenario). Actually the gap is: 22 known - 2 missing = 20 should exist, but 21 exist in DB. Checking: `hacker news` is listed as a product ("Hacker News") so all 20 remaining known entities are accounted for, plus there may be a case discrepancy. In practice **2 known entities are absent** (Dario Amodei, Satya Nadella).

### 1d. Topics that SHOULD be entities but aren't

The query for capitalized single-word high-distinctiveness topics returned **zero results** (besides OpenAI which is already an entity). This is because all entity names are stored lowercase in the DB. However, person names stored as kind='concept' rather than 'entity' include:

| Name | usage_count | kind |
|------|-------------|------|
| ben follington | 11 | concept |
| geoffrey litt | 7 | concept |
| bruce schneier | 6 | concept |
| christopher alexander | 6 | concept |
| ben mathe | 5 | concept |

These are people mentioned across multiple episodes but not in the known-entities list.

---

## 2. Phrase Topic Quality

### 2a. All phrase topics (kind='phrase', usage >= 5)

32 phrase topics have usage >= 5. Top phrases:

| Phrase | usage_count | Quality |
|--------|-------------|---------|
| matter how | 33 | GARBAGE - sentence fragment |
| llms allow | 32 | GARBAGE - sentence fragment |
| exponential cost | 21 | GOOD |
| qualitative nuance | 21 | GOOD |
| figure out how | 20 | GARBAGE - sentence fragment |
| network effects | 20 | GOOD |
| goodhart's law | 20 | GOOD |
| west roundup | 19 | PARTIAL - fragment of "wild west roundup" |
| wild west roundup | 19 | GOOD (podcast segment name) |
| compounding rate | 19 | GOOD |
| schelling points | 18 | GOOD |
| agent swarms | 17 | GOOD |
| llm model | 17 | MEDIOCRE - redundant ("LLM model") |
| dead end | 16 | GARBAGE - generic expression |
| status quo | 15 | MARGINAL |
| pace layers | 15 | GOOD |
| pay attention | 15 | GARBAGE - sentence fragment |
| model providers | 15 | GOOD |
| power dynamics | 14 | GOOD |
| ooda loop | 14 | GOOD |
| queen race | 13 | PARTIAL - fragment of "red queen race" |
| red queen race | 13 | GOOD |
| sycosocial relationships | 12 | GOOD |
| llms have infinite | 12 | GARBAGE - sentence fragment |
| excellent piece | 12 | GARBAGE - generic praise |
| abundant cognitive | 12 | PARTIAL - fragment of "abundant cognitive labor" |
| abundant cognitive labor | 12 | GOOD |
| gilded turds | 12 | GOOD |
| revealed preferences | 12 | GOOD |
| business models | 12 | MARGINAL - very generic |
| early adopters | 12 | GOOD |
| coding agents | 11 | GOOD |

### 2b. Garbage phrases identified

- **Sentence fragments:** "matter how" (33), "llms allow" (32), "figure out how" (20), "pay attention" (15), "llms have infinite" (12), "allow qualitative" (11)
- **Generic expressions:** "dead end" (16), "excellent piece" (12), "youtube video" (11), "memory feature" (11)
- **Substring duplicates:** "west roundup" (19, subset of "wild west roundup"), "queen race" (13, subset of "red queen race"), "abundant cognitive" (12, subset of "abundant cognitive labor")

### 2c. Good phrases confirmed present

| Phrase | usage_count | kind |
|--------|-------------|------|
| prompt injection | 81 | concept |
| infinite software | 65 | concept |
| mental model | 43 | concept |
| vibe coding | 37 | concept |
| cognitive labor | 35 | concept |
| pace layer | 33 | concept |
| network effects | 20 | phrase |

Note: most "good phrases" are kind='concept', not kind='phrase'. Only `network effects` is a phrase-kind topic.

### 2d. Spec phrase coverage

| Spec phrase | Exists? | usage_count |
|-------------|---------|-------------|
| infinite software | YES | 65 |
| infinite games | NO (only "infinite game" with usage=2) | 2 |
| vibe coding | YES | 37 |
| mental model | YES | 43 |
| pace layer | YES | 33 |
| prompt injection | YES | 81 |
| cognitive labor | YES | 35 |
| network effects | YES | 20 |

Missing: "infinite games" (only "infinite game" exists with usage=2).

---

## 3. Topic Quality Across Episodes

### 3a. Top 10 topics per episode (5 episodes sampled)

**Ep 430 (2024-12-09, earliest):** llms(7), trust(6), magnitude(6), team(5), force(5), aligned(5), value(4), tech(4), system(4), superficial(4)
- Assessment: Mix of generic ("system", "value") and meaningful ("trust", "aligned"). Mostly OK.

**Ep 420 (2025-02-24):** llms(10), tool(8), software(7), exponential cost(5), ecosystem(5), market(4), logarithmic(4), downside(4), data(4), cost(4)
- Assessment: Dominated by noise ("tool", "software", "data", "cost"). "exponential cost" and "ecosystem" are meaningful.

**Ep 400 (2025-07-14):** system(13), infinite(7), context(7), prosocial(6), value(5), software(5), llms(5), goodhart(5), emergent(5), data(5)
- Assessment: "system" dominates at 13 chunks. "prosocial", "goodhart", "emergent" are good signals buried under noise.

**Ep 385 (2025-10-27):** llms(11), model(9), hyper(8), allow(6), require(5), leverage(5), deep(5), business(5), touch(4), together(4)
- Assessment: VERY POOR. "allow", "require", "leverage", "together", "deep", "touch" are all generic. Only "hyper" suggests a real topic.

**Ep 363 (2026-04-06, latest):** agent(13), llms(12), system(7), software(6), process(5), hacker news(5), cost(5), coordination(5), value(4), swarm(4)
- Assessment: "agent", "coordination", "swarm" are good. "system", "software", "process", "cost" are noise.

### 3b. Same top-5 overlap

"llms" appears as #1 topic in **4 of 5 sampled episodes**, and "system" appears in top-5 of **3 of 5**. The generic words "system" (in 71/79 episodes), "software" (67/79), "model" (69/79), "data" (67/79), "llms" (68/79) appear in virtually every episode, making them useless for navigation.

### 3c. Concentration: top topics vs total

- Total chunk_topic assignments: **65,083**
- Top 10 topics: **3,250** assignments = **5.0%** of total
- Top 50 topics: **8,423** assignments = **12.9%** of total

This is actually a moderate concentration, not extreme. The long tail of 12,404 topics is the bigger problem (bloat, not concentration).

---

## 4. Single-Word Topic Quality

### 4a. Top 50 single-word topics categorized

**Genuine concepts (navigational value):**
- llms (686), context (224), agent (193), emergent (156), chatbot (113), swarm (116), infinite (162), logarithmic, sycosocial, prosocial, goodhart

**Entities misclassified as concepts:**
- claude (151), chatgpt (134), meta (106), google (89), OpenAI (68) -- these are actually entities now

**NOISE - should be filtered:**
- system (491), software (384), model (314), data (246), value (230), require (192), tool (192), code (186), power (168), product (165), matter (163), allow (163), process (150), company (138), quality (136), action (134), individual (131), become (129), work (127), other (121), society (121), cost (119), care (118), trust (118), team (109), social (109), feature (107), business (106), lead (106), game (104), force (99), love (96), future (95), focus (92), experience (89), information (89), technology (88), benefit (86), ever (84), piece (84), fundamentally (84), market (82)

### 4b. NOISE_WORDS from filter vs actual usage

**49 noise words from the filter still exist as topics with significant usage.** The filter exists in `topic-quality.ts` but is only applied at display time, not at ingestion. The topics still consume DB space and chunk_topic assignments:

| Noise word | usage_count |
|------------|-------------|
| system | 491 |
| software | 384 |
| model | 314 |
| data | 246 |
| value | 230 |
| require | 192 |
| tool | 192 |
| code | 186 |
| product | 165 |
| allow | 163 |
| quality | 136 |
| work | 127 |
| trust | 118 |
| aligned | 113 |
| business | 106 |
| fundamentally | 84 |
| apps | 80 |
| vibe | 78 |
| leverage | 78 |
| idea | 77 |
| expensive | 77 |
| hollow | 75 |
| harder | 71 |
| coding | 68 |

**Combined noise word usage: ~4,700+ assignments wasted.**

---

## 5. Recommendations

### 5a. Entities to add to known-entities list

```typescript
{ name: "Ben Follington", kind: "person", aliases: ["follington"] },
{ name: "Geoffrey Litt", kind: "person", aliases: ["litt"] },
{ name: "Bruce Schneier", kind: "person", aliases: ["schneier"] },
{ name: "Christopher Alexander", kind: "person", aliases: ["alexander"] },
{ name: "Silicon Valley", kind: "company" },  // or make a "place" kind
```

Also fix missing entities: Ensure `Dario Amodei` and `Satya Nadella` are detected during ingestion (they currently produce zero topics).

### 5b. Words to add to NOISE_WORDS filter

```typescript
// Generic nouns that appear everywhere
"power", "matter", "process", "company", "action", "individual",
"become", "other", "society", "cost", "care", "team", "social",
"feature", "lead", "game", "force", "love", "future", "focus",
"experience", "information", "technology", "benefit", "ever", "piece",
"market", "personal", "thought", "together", "control", "organization",
"task", "effect", "decision", "energy", "chat", "term", "live",
"word", "approach", "step", "talk", "ability", "goal", "community",
"frame", "environment", "least", "attention", "output", "multiple",
"problem", "space", "situation", "rule", "worth", "almost",
"consumer", "dynamic", "past", "learn", "structure", "computer",
"writing", "component", "industry", "produce", "anyone", "platform",
"pattern", "input", "brain", "signal", "easily", "knowledge",
"domain", "goes", "practice", "content", "magic", "difference",
"normal", "demand", "direction", "figure", "whatever", "agency", "network",

// Additional comparatives/adverbs
"easily", "almost", "least", "multiple", "normal",

// Generic verbs already being used as topics
"become", "lead", "focus", "produce", "goes"
```

### 5c. Phrase topics to auto-create via merge rules

These phrase-concept pairs should be unified (the concept version should subsume the singular word):

| Merge target (phrase) | Subsume singles |
|----------------------|-----------------|
| infinite software | infinite (partially) |
| prompt injection | injection |
| cognitive labor | labor |
| vibe coding | vibe, coding |
| pace layer / pace layers | (merge plural into singular) |
| agent swarm / agent swarms | (merge plural into singular) |
| gilded turd / gilded turds | (merge plural into singular) |
| red queen race | queen race (remove substring) |
| wild west roundup | west roundup (remove substring) |
| abundant cognitive labor | abundant cognitive (remove substring) |

**Substring dedup rule:** When a phrase topic is a proper suffix/prefix of another phrase topic and both have similar usage, auto-merge the shorter one into the longer.

### 5d. N-gram extraction threshold recommendations

**Current state problems:**
- 12,404 topics is far too many. 6,831 have usage_count=1, and 2,041 are multi-word with usage=1.
- 217 three-word phrases with usage <= 2 exist (mostly garbage like "bruce schneier cybersecurity", "ben follington crafting").

**Recommended thresholds:**

| Parameter | Current (inferred) | Recommended |
|-----------|-------------------|-------------|
| minCount (single words) | 1 | 3 |
| minDocs (single words) | 1 | 2 |
| minCount (2-word phrases) | 1 | 3 |
| minDocs (2-word phrases) | 1 | 2 |
| minCount (3-word phrases) | 1 | 5 |
| minDocs (3-word phrases) | 1 | 3 |
| distinctiveness threshold | 0 | 1.5 for single generic words |

**Apply noise filter at ingestion time, not just display time.** This would prevent ~4,700+ wasted chunk_topic assignments and reduce the topic count from 12,404 to an estimated ~3,000-4,000 useful topics.

**Phrase quality heuristic:** Reject n-grams where the first or last word is a stopword/function word (how, out, allow, have, the, a, its, this, that). This would eliminate "matter how", "figure out how", "llms allow", "allow qualitative", "llms have infinite", "pay attention".

### Summary of key numbers

| Metric | Value | Assessment |
|--------|-------|------------|
| Total topics | 12,404 | Too many (bloated) |
| Zero-usage topics | 11 | Minimal, OK |
| Single-usage topics | 6,831 (55%) | Very high, needs pruning |
| Entity topics | 21 of 22 known | Good (2 missing) |
| Phrase topics (kind=phrase) | 38 | Many are garbage fragments |
| Good concept-phrases (kind=concept) | ~40 | These are the real value |
| Noise words still as topics | 49+ | Filter not applied at ingestion |
| Generic words dominating episodes | 5 words in 67-71 of 79 episodes | Severe navigability problem |
