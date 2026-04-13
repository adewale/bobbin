# Cloudflare Best Practices for Bobbin Enrichment Pipeline

## 1. D1 Query Optimization

**Replace NOT IN with LEFT JOIN WHERE NULL.** The current `getUnenrichedChunks` uses `WHERE c.id NOT IN (SELECT DISTINCT chunk_id FROM chunk_topics)`, which forces a full scan of `chunk_topics` for every candidate row. Rewrite as:

```sql
SELECT c.id, c.episode_id, c.content_plain
FROM chunks c
LEFT JOIN chunk_topics ct ON c.id = ct.chunk_id
WHERE ct.chunk_id IS NULL
LIMIT ?
```

For SQLite/D1, both patterns can perform similarly on small datasets, but LEFT JOIN avoids the anti-pattern of materializing the entire subquery result set. The real fix is adding a boolean column:

```sql
ALTER TABLE chunks ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0;
-- Then query becomes:
SELECT id, episode_id, content_plain FROM chunks WHERE enriched = 0 LIMIT ?
-- After enrichment:
UPDATE chunks SET enriched = 1 WHERE id IN (...)
```

This eliminates the join entirely and uses a simple indexed scan. Add `CREATE INDEX idx_chunks_enriched ON chunks(enriched) WHERE enriched = 0` for a partial index.

**D1 batch limits:** No hard cap on statements per `db.batch()`, but the entire batch must complete within 30 seconds. Max 100 bound parameters per statement. Max 1,000 queries per Worker invocation (paid). Current `batchExec` uses size=50, which is conservative. Increase to 100 for write-heavy batches since each statement is small.

**Time Travel for safe re-enrichment:** D1 Time Travel is always-on, retains 30 days on paid plan, and allows restoring to any minute. Before a full re-enrichment, note the timestamp. If something goes wrong, restore via `wrangler d1 time-travel restore bobbin-db --timestamp=<ISO8601>`. Caveat: restore is destructive and overwrites the database in place.

## 2. Workers CPU Optimization

**CPU time vs I/O wait:** On the paid plan, default is 30s CPU, configurable up to 5 minutes. Only active code execution counts as CPU time. All `fetch()`, D1 queries, KV reads, and queue sends are I/O wait and do NOT count. The `enrichChunks` function spends most time on `extractTopics` (pure CPU) and D1 writes (I/O). The 16-chunk limit is likely overcautious -- the CPU budget allows far more.

**Increase batch size:** Raise `enrichChunks` batch from 16 to 100-200. Profile with `console.log(Date.now())` around `extractTopics` to measure actual CPU per chunk. If topic extraction takes ~10ms per chunk, you can process 200+ chunks in 2-3 seconds of CPU time, well within the 30s default.

**Aggressive D1 batching:** Increase `batchExec` size from 50 to 100. Combine related operations: insert topics, insert chunk_topics, and insert chunk_words in fewer batch calls by concatenating statement arrays before calling `batchExec`.

**ctx.waitUntil for post-response work:** Already used correctly in `scheduled()`. For the queue consumer, the `queue()` handler has no response to send early, so `waitUntil` does not help there. For HTTP API routes (like `/api/ingest`), wrap finalization in `ctx.waitUntil()` to return the response immediately while enrichment continues.

## 3. Queue Configuration

**Increase max_batch_size.** Current: 10. The platform maximum is 100. Since each message does 2-5 D1 queries, a batch of 10 means 20-50 queries per invocation (well under the 1,000 limit). Raise to 50:

```jsonc
"consumers": [{
  "queue": "bobbin-enrichment",
  "max_batch_size": 50,
  "max_concurrency": 20,
  "max_retries": 3,
  "retry_delay": 30
}]
```

**Increase max_concurrency to 20.** The platform supports up to 250 concurrent consumers. D1 allows 6 simultaneous connections per Worker invocation, but each consumer is a separate invocation. At 20 concurrency with sequential D1 queries, contention should be manageable. Monitor for D1 errors and back off if needed.

**Implement exponential backoff in the consumer.** The current code calls `msg.retry()` on error with no delay. Use the message's `attempts` property:

```typescript
catch (e) {
  const delay = Math.min(60, Math.pow(2, msg.attempts) * 5);
  msg.retry({ delaySeconds: delay });
}
```

**Multiple queues vs message-type routing:** Keep the single queue. The current three message types (`compute-related`, `assign-ngram`, `extract-ngrams`) share the same D1 database and have similar latency profiles. Multiple queues add configuration complexity without throughput benefit. The current type-dispatch pattern is idiomatic.

## 4. Cron Trigger to Workflow Migration

**Current problem:** The cron handler runs `runRefresh` inline via `ctx.waitUntil`, which has a 15-minute wall-clock limit. The enrichment loop (`enrichAllChunks` with 120s budget) plus finalization can exceed this on large ingestion runs.

**Recommended: Cron triggers Workflow.** Workflows have unlimited wall-clock time per step, up to 10,000 steps (paid), and per-step retry with configurable backoff. Convert the pipeline to a Workflow:

```typescript
// wrangler.jsonc addition:
"workflows": [{
  "name": "bobbin-refresh",
  "binding": "REFRESH_WORKFLOW",
  "class_name": "RefreshWorkflow"
}]

// Workflow class:
export class RefreshWorkflow extends WorkflowEntrypoint<Env, {}> {
  async run(event: WorkflowEvent<{}>, step: WorkflowStep) {
    const html = await step.do("fetch-doc", { retries: { limit: 3, delay: "10 seconds" } },
      async () => { /* fetchGoogleDoc */ });
    const episodes = await step.do("parse", async () => { /* parseHtmlDocument */ });
    await step.do("ingest", async () => { /* ingestEpisodesOnly */ });
    // Loop enrichment in steps of 200 chunks
    let enriched = 0;
    do {
      const batch = await step.do(`enrich-batch-${enriched}`, async () => {
        return await enrichChunks(this.env.DB, 200);
      });
      enriched += batch.chunksProcessed;
    } while (enriched > 0);
    await step.do("finalize", async () => { /* finalizeEnrichment */ });
  }
}

// Cron handler becomes:
async scheduled(_event, env, ctx) {
  await env.REFRESH_WORKFLOW.create({ id: `refresh-${Date.now()}` });
}
```

Each step persists its result. If the Worker restarts, the Workflow resumes from the last completed step. CPU time limit per step is 30s (configurable to 5 min), plenty for a batch of 200 chunks.

## 5. Analytics Engine for Pipeline Metrics

**Replace structured console.log with Analytics Engine.** Current logging is ephemeral (visible only in `wrangler tail` or Workers Logs). Analytics Engine provides queryable, retained metrics.

```jsonc
// wrangler.jsonc:
"analytics_engine_datasets": [{
  "binding": "PIPELINE_METRICS",
  "dataset": "bobbin_pipeline"
}]
```

```typescript
// After each pipeline step:
env.PIPELINE_METRICS.writeDataPoint({
  indexes: [runId],
  blobs: ["enrich", status, failedStep ?? ""],
  doubles: [chunksProcessed, durationMs, errorCount]
});
```

Writes are non-blocking and add no latency. Query via SQL API for dashboards:

```sql
SELECT blob1 AS step,
       SUM(_sample_interval * double1) AS total_chunks,
       AVG(_sample_interval * double2) AS avg_duration_ms
FROM bobbin_pipeline
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY step
```

**Keep structured console.log too** for real-time debugging via `wrangler tail`. Analytics Engine is for trends and alerting; logs are for incident response.

## Summary of Priority Changes

| Change | Effort | Impact |
|--------|--------|--------|
| Add `enriched` column + partial index | Low | Eliminates O(N) scan per batch |
| Increase enrichChunks batch to 200 | Low | 10x fewer invocations |
| Increase queue max_batch_size to 50, max_concurrency to 20 | Low | 5x faster finalization |
| Add exponential backoff to queue retry | Low | Prevents retry storms |
| Migrate pipeline to Workflow | Medium | Eliminates 15-min wall-clock limit, adds per-step retry |
| Add Analytics Engine metrics | Medium | Queryable pipeline health data |
| Increase batchExec size to 100 | Low | Fewer D1 round-trips |
