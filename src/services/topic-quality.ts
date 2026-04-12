/** Words that are never standalone topics -- too generic or grammatical */
const NOISE_WORDS = new Set([
  // Comparative/superlative adjectives
  "harder", "easier", "faster", "slower", "bigger", "smaller", "better", "worse",
  "higher", "lower", "deeper", "wider", "longer", "shorter", "stronger", "weaker",
  // Generic verbs/adjectives
  "aligned", "leverage", "focused", "driven", "based", "built", "designed",
  "allow", "create", "enable", "require", "involve", "include",
  // Too generic nouns
  "apps", "tool", "tools", "product", "products", "thing", "things",
  "people", "person", "world", "point", "part", "kind", "type",
  "time", "place", "work", "idea", "value", "case", "form",
  "record", "expensive", "important", "interesting", "different",
  // Words only meaningful in specific phrases
  "injection", "labor", "hollow",
]);

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
