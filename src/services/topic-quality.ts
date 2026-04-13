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
]);

/**
 * Check if a topic name is a noise word that should never be shown standalone.
 */
export function isNoiseTopic(name: string): boolean {
  const lower = name.toLowerCase();
  if (NOISE_WORDS.has(lower)) return true;
  if (!lower.includes(" ") && lower.length < 4) return true;
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
