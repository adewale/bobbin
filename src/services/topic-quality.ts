/** Words that are never standalone topics — too generic or grammatical */
const NOISE_WORDS = new Set([
  // Comparative/superlative adjectives
  "harder", "easier", "faster", "slower", "bigger", "smaller", "better", "worse",
  "higher", "lower", "deeper", "wider", "longer", "shorter", "stronger", "weaker",
  // Generic verbs/adjectives
  "aligned", "leverage", "focused", "driven", "based", "built", "designed",
  "allow", "create", "enable", "require", "involve", "include",
  "fundamentally", "basically", "essentially", "relatively",
  "become", "becoming", "happened", "happening", "imagine", "assume",
  "consider", "approach", "change", "changing", "started",
  // Too generic nouns — not navigational even in a tech corpus
  "software", "system", "model", "data", "code", "product", "tool", "tools",
  "products", "apps", "thing", "things", "people", "person", "world", "point",
  "part", "kind", "type", "time", "place", "work", "idea", "value", "case",
  "form", "record", "trust", "quality", "business", "power", "matter",
  "action", "process", "company", "individual", "future", "order",
  "space", "level", "layer", "number", "result", "problem", "question",
  "state", "sense", "reason", "experience", "example", "information",
  "content", "version", "source", "feature", "user", "users",
  "expensive", "important", "interesting", "different",
  "require", "exist", "expect", "possible", "specific",
  "scale", "cost", "society", "team", "loop", "care", "other",
  "context", "tech", "infinite", "signal", "market", "internal",
  // Words only meaningful in specific phrases
  "injection", "labor", "hollow", "coding", "vibe",
  // Generic nouns — low distinctiveness, high usage
  "game", "lead", "love", "wrong", "grow", "social", "focus",
  "technology", "attention", "opportunity", "incentive", "relationship",
  "pattern", "human", "conversation", "decision", "environment",
  "strategy", "creative", "energy", "dynamic", "challenge", "influence",
  "potential", "resource", "competition", "knowledge", "effort", "rate",
  "pressure", "risk", "complexity", "effective", "advantage", "fundamental",
  "structure", "evolution", "community", "standard", "network", "generation",
  "medium", "capable", "platform", "practice", "operate", "opinion",
  "force", "argue", "respond", "access", "concern", "emerge", "alignment",
  // Common verbs that appear as TF-IDF topics but are never navigational
  "asked", "told", "insisted", "aimed", "ignore", "immediately",
  "described", "explained", "claimed", "suggested", "proposed", "discussed",
  "mentioned", "observed", "noted", "argued", "stated", "reported",
  "revealed", "announced", "published", "presented",
  // Empirically found by scripts/analyze-topics.ts on 20 episodes (994 chunks).
  // These all appeared in the top 50 topics but are not navigational.
  // Adjectives/adverbs that describe but don't name
  "emergent", "resonant", "authentic", "collective", "personal",
  "negative", "dangerous", "abstract", "obvious", "concrete",
  "fragile", "shallow", "narrow", "broad", "subtle", "bold",
  "novel", "mature", "organic", "native", "open-ended",
  // Nouns too generic for navigation (even in a tech corpus)
  "moment", "outcome", "insight", "magnitude", "resonance",
  "preference", "aspiration", "nuance", "tendency", "tension",
  "friction", "momentum", "dimension", "threshold", "trajectory",
  "boundary", "gravity", "entropy", "spectrum", "catalyst",
  "symptom", "surface", "artifact", "ingredient", "recipe",
  "niche", "habitat", "taste", "shelf", "identity",
  "externality", "interaction", "feedback",
  "output", "intelligence", "research", "story", "benefit",
  // Common verbs that TF-IDF surfaces
  "realize", "improve", "shift", "tend", "talk", "control",
  "live", "connect", "consolidate", "absorb", "expand", "decline",
  "transform", "replace", "disrupt", "adapt", "evolve", "launch",
  "acquire", "collapse", "ship", "release",
  // Short/generic words
  "ever", "least", "ones", "second", "term", "piece", "mind",
  "chat", "found",
  // Round 2: empirical garbage from analyze-topics.ts after first cleanup
  "alive", "imply", "word", "qualitative", "quantitative", "belief",
  "task", "entity", "stay", "align", "option", "valuable", "goal",
  "test", "deep", "desire", "push", "input", "organization",
  "blossom", "agree", "execute", "either", "effect", "goes",
  "negative", "positive", "consumer", "attempt", "claim",
  "danger", "defend", "imagine", "quite", "rare",
  // Round 3: conversational verbs/adjectives YAKE surfaces from newsletter tone
  "need", "want", "like", "take", "hard", "believe", "feel",
  "think", "know", "make", "give", "keep", "call", "mean",
  "look", "seem", "tell", "come", "show", "play", "move",
  "turn", "start", "stop", "open", "close", "pull", "hold",
  "real", "true", "clear", "high", "long", "good", "best",
  "full", "free", "easy", "fast", "huge", "able", "sure",
  // Round 4: stragglers from local corpus analysis at full scale
  "used", "life", "great", "answer", "impossible", "alway",
  "always", "little", "become", "single", "sort", "sense",
  "bring", "miss", "learn", "rest", "fact", "idea",
]);

/**
 * Check if a topic name is a noise word that should never be shown standalone.
 *
 * Uses three layers:
 * 1. Explicit NOISE_WORDS set (manually curated)
 * 2. Length filter (< 4 chars for single words)
 * 3. Suffix heuristics (catch common verb/adjective/adverb patterns)
 */
export function isNoiseTopic(name: string): boolean {
  const lower = name.toLowerCase();
  if (NOISE_WORDS.has(lower)) return true;
  if (!lower.includes(" ") && lower.length < 4) return true;

  // Multi-word phrases: reject if starts with generic pronoun/determiner
  if (lower.includes(" ")) {
    const words = lower.split(/\s+/);
    const GENERIC_STARTERS = new Set([
      "someone", "everyone", "something", "everything", "anyone", "anything",
      "nobody", "nothing", "whoever", "whatever", "however",
    ]);
    if (GENERIC_STARTERS.has(words[0])) return true;
    // Reject if ALL words are common verbs/adjectives (not domain nouns)
    const FILLER_WORDS = new Set([
      "make", "take", "give", "keep", "come", "show", "play", "move", "turn",
      "need", "want", "like", "feel", "think", "know", "believe", "tell",
      "good", "best", "real", "true", "hard", "fast", "high", "long",
      "work", "thing", "place", "world", "point", "part",
    ]);
    const allFiller = words.every(w => FILLER_WORDS.has(w) || w.length < 4);
    if (allFiller) return true;
    return false;
  }

  // Suffix heuristics for single words only — catch structural patterns
  // that the explicit list can't cover exhaustively
  if (!lower.includes(" ")) {
    // Adverbs ending in -ly (e.g., "extremely", "quickly", "essentially")
    if (lower.endsWith("ly") && lower.length >= 6) return true;
    // Common verb endings that produce non-navigational topics
    // -ize (realize, optimize), -ify (qualify, simplify), -ate (create, operate)
    // Exclude domain terms: "tokenize", "vectorize", "containerize"
    if (lower.endsWith("ize") && lower.length <= 8) return true;
    if (lower.endsWith("ify") && lower.length <= 8) return true;
    // -ment (moment, alignment, argument) — exclude "deployment", "embedment"
    if (lower.endsWith("ment") && lower.length <= 9) return true;
    // Common single-word verbs: goes, stays, makes, takes, gives
    if (lower.endsWith("oes") || lower.endsWith("ays") || lower.endsWith("akes") || lower.endsWith("ives")) return true;
  }

  return false;
}

/**
 * Suppress single words that are components of multi-word topics in the same context.
 * E.g., if "prompt injection" is present, suppress standalone "prompt" and "injection".
 */
export function suppressComponentWords<T extends { name: string }>(topics: T[]): T[] {
  const multiWords = topics.filter(t => t.name.includes(" "));
  const componentWords = new Set<string>();
  for (const mw of multiWords) {
    for (const word of mw.name.toLowerCase().split(/\s+/)) {
      componentWords.add(word);
    }
  }
  return topics.filter(t => t.name.includes(" ") || !componentWords.has(t.name.toLowerCase()));
}

/**
 * Filter and rank topics for display quality.
 * - Removes noise words
 * - Suppresses single words that mostly appear inside phrase topics
 * - Returns the cleaned, ranked list
 */
export function curateTopics(
  topics: { name: string; slug: string; usage_count: number; distinctiveness: number }[],
  phraseTopics: { name: string; usage_count: number }[]
): { name: string; slug: string; usage_count: number; distinctiveness: number }[] {
  // Build a set of words that are part of established phrases
  const phraseComponentWords = new Set<string>();
  for (const p of phraseTopics) {
    for (const word of p.name.toLowerCase().split(/\s+/)) {
      phraseComponentWords.add(word);
    }
  }

  return topics.filter(t => {
    const name = t.name.toLowerCase();

    // Remove noise words
    if (NOISE_WORDS.has(name)) return false;

    // Remove single words < 4 chars (unless high usage)
    if (!name.includes(" ") && name.length < 4 && t.usage_count < 20) return false;

    // Suppress single words that are subsumed by phrases
    // If "coding" is a component of "vibe coding" and "vibe coding" has >= 40% of "coding"'s usage, suppress it
    if (!name.includes(" ") && phraseComponentWords.has(name)) {
      const matchingPhrases = phraseTopics.filter(p =>
        p.name.toLowerCase().split(/\s+/).includes(name)
      );
      const phraseUsage = matchingPhrases.reduce((sum, p) => sum + p.usage_count, 0);
      if (phraseUsage >= t.usage_count * 0.4) return false; // 40% threshold
    }

    return true;
  });
}
