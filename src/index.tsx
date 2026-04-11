import { Hono } from "hono";
import type { AppEnv, Bindings } from "./types";
import { homeRoutes } from "./routes/home";
import { episodeRoutes } from "./routes/episodes";
import { chunkRoutes } from "./routes/chunks";
import { tagRoutes } from "./routes/tags";
import { searchRoutes } from "./routes/search";
import { timelineRoutes } from "./routes/timeline";
import { concordanceRoutes } from "./routes/concordance";
import { feedRoutes } from "./routes/feeds";
import { apiRoutes } from "./routes/api";
import { runRefresh } from "./jobs/refresh";

const app = new Hono<AppEnv>();

// Error handler — show details in dev
app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack);
  return c.text(`Error: ${err.message}`, 500);
});

// Cache-Control for SSR pages
app.use("*", async (c, next) => {
  await next();
  if (
    c.res.headers.get("content-type")?.includes("text/html") &&
    !c.res.headers.has("cache-control")
  ) {
    c.res.headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
  }
});

app.route("/", homeRoutes);
app.route("/episodes", episodeRoutes);
app.route("/chunks", chunkRoutes);
app.route("/tags", tagRoutes);
app.route("/search", searchRoutes);
app.route("/timeline", timelineRoutes);
app.route("/concordance", concordanceRoutes);
app.route("/", feedRoutes);
app.route("/api", apiRoutes);

// 404 handler
app.notFound((c) => {
  return c.html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found | Bobbin</title></head><body>
    <header><nav><a href="/">Bobbin</a></nav></header>
    <main><h1>404 — Not Found</h1><p>The page you're looking for doesn't exist.</p>
    <p><a href="/">Go home</a> · <a href="/search">Search</a> · <a href="/episodes">Browse episodes</a></p>
    </main></body></html>`,
    404
  );
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext
  ) {
    try {
      await runRefresh(env);
    } catch (e) {
      console.error("Refresh failed:", e);
    }
  },
};
