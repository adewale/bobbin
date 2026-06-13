# Queue DLQ replay

The enrichment consumer is configured with `max_retries: 3`, delayed retries, and the `bobbin-enrichment-dlq` dead-letter queue. Before deploying this config in a new account, create the DLQ once:

```bash
npx wrangler queues create bobbin-enrichment-dlq --config wrangler.jsonc
```

## Inspect DLQ messages

Use the Cloudflare dashboard queue view and Workers Logs for `bobbin-enrichment-dlq` / `bobbin-enrichment`. `wrangler queues info bobbin-enrichment-dlq --config wrangler.jsonc` is useful for queue metadata, but message-body inspection/replay is operationally handled from Cloudflare tooling or a temporary, reviewed replay Worker.

Check each message body and the related Worker logs before replaying. Deterministic failures (bad SQL shape, invalid message body) should be fixed before replay.

## Replay procedure

1. Pause or reduce the main `bobbin-enrichment` consumer if the original incident is still active.
2. Review a small DLQ sample and confirm the payload type is supported by `src/jobs/queue-handler.ts`.
3. Re-send messages to `bobbin-enrichment` in small batches.
4. Watch queue metrics, Worker errors, and D1/AI/Vectorize usage while replaying.
5. Stop replay if retryable errors recur and leave remaining messages in the DLQ for investigation.

## Expected retry behavior

Retryable infrastructure/D1/AI failures call `msg.retry({ delaySeconds })` with bounded exponential backoff plus equal jitter. The per-attempt maximums are 30s, 60s, 120s, then capped at 300s; actual delays are randomized in the upper half of each window to avoid synchronized retry spikes. After configured retries are exhausted, Cloudflare moves the message to `bobbin-enrichment-dlq` instead of silently deleting it.

Non-retryable (deterministic) failures are not retried: the consumer records the failure in `queue_message_state`, forwards the message body directly to `bobbin-enrichment-dlq` via the `ENRICHMENT_DLQ` producer binding, and acks. Every failed message therefore reaches the DLQ — either through exhausted retries or through the direct forward — so the replay procedure above covers both classes once the underlying bug is fixed.
