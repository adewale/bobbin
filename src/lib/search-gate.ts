/**
 * Shared abuse controls for the public search surfaces.
 * Both the HTML route (/search) and the JSON API (/api/search) must apply
 * the same query-length cap and per-IP rate limit; an unthrottled twin
 * endpoint is an open D1 CPU amplification vector.
 */
import type { Bindings } from "../types";

export const MAX_PUBLIC_SEARCH_QUERY_LENGTH = 200;
export const PUBLIC_SEARCH_RATE_LIMIT = 60;
export const PUBLIC_SEARCH_RATE_WINDOW_SECONDS = 60;

interface SearchGateContext {
  req: { url: string; header: (name: string) => string | undefined };
  env: Bindings;
}

export function searchRateLimitKey(c: SearchGateContext): string {
  return c.req.header("CF-Connecting-IP")
    ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "anonymous";
}

export async function allowPublicSearch(c: SearchGateContext): Promise<boolean> {
  const url = new URL(c.req.url);
  if (!c.env.SEARCH_RATE_LIMIT && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;

  const key = searchRateLimitKey(c);
  if (c.env.SEARCH_RATE_LIMIT) {
    const outcome = await c.env.SEARCH_RATE_LIMIT.limit({ key });
    return outcome.success;
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % PUBLIC_SEARCH_RATE_WINDOW_SECONDS);
  await c.env.DB.prepare(
    `INSERT INTO search_rate_limit_state (key, window_start, count, updated_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1, updated_at = datetime('now')`
  ).bind(key, windowStart).run();
  const row = await c.env.DB.prepare(
    "SELECT count FROM search_rate_limit_state WHERE key = ? AND window_start = ?"
  ).bind(key, windowStart).first() as { count: number } | null;
  if (Math.random() < 0.01) {
    await c.env.DB.prepare("DELETE FROM search_rate_limit_state WHERE window_start < ?").bind(windowStart - 3600).run();
  }
  return (row?.count ?? 0) <= PUBLIC_SEARCH_RATE_LIMIT;
}
