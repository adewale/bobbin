/**
 * Decode common HTML entities. Consolidated from html-parser, tag-generator, text.
 */
export function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Escape a string for safe embedding in a JSON <script> block.
 * Prevents </script> breakout (S4).
 */
export function safeJsonForHtml(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

/**
 * Escape regex metacharacters in a string for use in new RegExp().
 * Prevents regex injection (B1).
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape LIKE metacharacters for D1/SQLite queries (S2).
 */
export function escapeLike(str: string): string {
  return str.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Sanitize FTS5 query input (S3).
 * Wraps user input in double quotes to prevent FTS operator injection.
 */
export function sanitizeFtsQuery(query: string): string {
  // Remove double quotes to prevent breaking out, then wrap in quotes
  return '"' + query.replace(/"/g, "") + '"';
}

/**
 * Escape string for XML element content and attributes (D2, S6).
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Derive BASE_URL from request or use default (D3).
 */
export function getBaseUrl(requestUrl?: string): string {
  if (requestUrl) {
    try {
      const url = new URL(requestUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }
  return "https://bobbin.adewale-883.workers.dev";
}

/**
 * Parse an integer from a query param with a default value (B3, B6).
 * Returns the default if the value is not a valid positive integer.
 */
export function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) return defaultValue;
  return parsed;
}
