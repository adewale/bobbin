import { Hono } from "hono";
import type { AppEnv, Bindings } from "./types";
import { Layout } from "./components/Layout";
import { homeRoutes } from "./routes/home";
import { episodeRoutes } from "./routes/episodes";
import { chunkRoutes } from "./routes/chunks";
import { topicRoutes } from "./routes/topics";
import { searchRoutes } from "./routes/search";
import { apiRoutes } from "./routes/api";
import { designRoutes } from "./routes/design";
import { summaryRoutes } from "./routes/summaries";
import { runRefresh } from "./jobs/refresh";
import { handleEnrichmentBatch, type EnrichmentMessage } from "./jobs/queue-handler";
import { isTuesdayNineAmLondon } from "./lib/london-cron";

const app = new Hono<AppEnv>();

// Error handler — show details in dev
app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack);
  return c.text("Internal Server Error", 500);
});

// Security headers + Cache-Control for SSR pages
app.use("*", async (c, next) => {
  await next();
  // Responses served from the Cache API have immutable headers; rebuild
  // the response so the security headers apply to cache hits too.
  try {
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  } catch {
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  }
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (c.res.headers.get("content-type")?.includes("text/html")) {
    c.res.headers.set("X-Frame-Options", "DENY");
    // Backstops the rendered-content sinks: no inline/eval script can run
    // even if a hostile fragment ever reaches the page.
    c.res.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' https: data:; " +
      "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
  }
  if (
    c.req.method === "GET" &&
    !new URL(c.req.url).pathname.startsWith("/api/") &&
    c.res.headers.get("content-type")?.includes("text/html") &&
    !c.res.headers.has("cache-control")
  ) {
    c.res.headers.set("Cache-Control", "public, max-age=300, s-maxage=3600");
  }
});

app.route("/", homeRoutes);
app.route("/episodes", episodeRoutes);
app.route("/chunks", chunkRoutes);
app.route("/topics", topicRoutes);
app.route("/summaries", summaryRoutes);
app.route("/search", searchRoutes);
app.route("/api", apiRoutes);
app.route("/design", designRoutes);

// 404 handler — uses Layout for consistency
app.notFound((c) => {
  return c.html(
    <Layout title="Not Found" description="Page not found">
      <h1>Not found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <p>
        <a href="/">Home</a> &middot;{" "}
        <a href="/search">Search</a> &middot;{" "}
        <a href="/episodes">Episodes</a>
      </p>
    </Layout>,
    404
  );
});

export default {
  fetch: app.fetch,
  async scheduled(
    event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext
  ) {
    if (!isTuesdayNineAmLondon(event.scheduledTime)) {
      console.log(JSON.stringify({
        event: "refresh_skip",
        reason: "not_target_london_time",
        scheduled_time: new Date(event.scheduledTime).toISOString(),
      }));
      return;
    }
    // ctx.waitUntil ensures async work (queue sends) completes before Worker terminates
    ctx.waitUntil(runRefresh(env));
  },
  async queue(
    batch: MessageBatch<EnrichmentMessage>,
    env: Bindings
  ) {
    const start = Date.now();
    const types = batch.messages.map(m => m.body.type);
    try {
      await handleEnrichmentBatch(batch, env);
      console.log(JSON.stringify({
        event: "queue_batch",
        messages: batch.messages.length,
        types: [...new Set(types)],
        duration_ms: Date.now() - start,
        status: "completed",
      }));
    } catch (e) {
      console.error(JSON.stringify({
        event: "queue_batch",
        messages: batch.messages.length,
        types: [...new Set(types)],
        duration_ms: Date.now() - start,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      }));
      throw e;
    }
  },
};
