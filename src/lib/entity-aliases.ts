import type { KnownEntity } from "../data/known-entities";

/**
 * Given a query string and a list of known entities, check if any entity
 * name or alias appears in the query. If so, return the canonical name
 * and all aliases (lowercased) for FTS OR expansion.
 *
 * Returns an empty array if no entity matches.
 */
export function expandEntityAliases(
  query: string,
  entities: KnownEntity[]
): string[] {
  const lower = query.toLowerCase();
  for (const entity of entities) {
    const allNames = [
      entity.name.toLowerCase(),
      ...(entity.aliases || []).map((a) => a.toLowerCase()),
    ];
    if (allNames.some((name) => lower.includes(name))) {
      return allNames;
    }
  }
  return [];
}
