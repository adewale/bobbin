import { Hono } from "hono";
import type { AppEnv, Bindings } from "./types";
import { Layout } from "./components/Layout";
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
