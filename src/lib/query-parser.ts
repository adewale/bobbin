export interface ParsedQuery {
  text: string;       // remaining free text after extracting operators
  phrases: string[];  // exact phrases from "..." quotes
  before?: string;    // before:YYYY-MM-DD
  after?: string;     // after:YYYY-MM-DD
  year?: number;      // year:YYYY
}

/**
 * Parse a search query string, extracting operators and exact phrases.
 *
 * Operators:
 *   before:2025-06-01  — episodes before this date
 *   after:2024-01-01   — episodes after this date
 *   year:2025          — episodes from this year
 *   "exact phrase"     — must contain this exact phrase
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  let text = raw;
  const phrases: string[] = [];
  let before: string | undefined;
  let after: string | undefined;
  let year: number | undefined;

  // Extract exact phrases
  text = text.replace(/"([^"]+)"/g, (_, phrase) => {
    phrases.push(phrase.trim());
    return "";
  });

  // Extract before:
  text = text.replace(/before:(\d{4}-\d{2}-\d{2})/g, (_, date) => {
    before = date;
    return "";
  });

  // Extract after:
  text = text.replace(/after:(\d{4}-\d{2}-\d{2})/g, (_, date) => {
    after = date;
    return "";
  });

  // Extract year:
  text = text.replace(/year:(\d{4})/g, (_, y) => {
    year = parseInt(y, 10);
    return "";
  });

  return {
    text: text.replace(/\s+/g, " ").trim(),
    phrases,
    before,
    after,
    year,
  };
}
