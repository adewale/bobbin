# Production alert checks

This repo includes a manual production alert checker. It does **not** require GitHub repo settings unless you choose to wire it into GitHub Actions later.

Run locally or from any scheduler that can provide a Cloudflare token:

```bash
CLOUDFLARE_API_TOKEN="..." npm run alerts:production
```

Optional chat notification:

```bash
ALERT_WEBHOOK_URL="..." CLOUDFLARE_API_TOKEN="..." npm run alerts:production
```

If `ALERT_WEBHOOK_URL` is omitted, the script still prints JSON and exits non-zero on alert conditions.

## Conditions checked

- `ingestion_log.status = 'running'` older than `STALE_RUNNING_MINUTES` (default: `30`).
- failed `refresh` / `refresh_cycle` rows completed in the last `FAILED_REFRESH_HOURS` (default: `24`).
- `bobbin-enrichment-dlq` has at least one message. The check uses Cloudflare Queues pull with a 1-second visibility timeout and does not ack messages. The DLQ must have HTTP Pull enabled once:

```bash
npx wrangler queues consumer http add bobbin-enrichment-dlq --config wrangler.remote.jsonc --visibility-timeout-secs 1
```
- Workers AI and Vectorize spikes based on `cloudflare_cost_events` written by app code:
  - `WORKERS_AI_EVENT_THRESHOLD` default `500` events/hour
  - `WORKERS_AI_UNIT_THRESHOLD` default `5000` units/hour
  - `VECTORIZE_EVENT_THRESHOLD` default `1000` events/hour
  - `VECTORIZE_UNIT_THRESHOLD` default `5000000` vector dimensions/hour

## Is this useful without GitHub Actions?

Yes. The useful remainder is:

- one command that checks all four production risk conditions
- app-level AI/Vectorize cost-event recording in D1
- JSON output suitable for local cron, launchd, another monitoring system, or manual incident checks
- optional webhook notification without coupling to GitHub repo secrets

## Notes

`cloudflare_cost_events` measures Bobbin app-level usage of Workers AI and Vectorize (search, embed, ingest, LLM enrichment). It is not a billing API replacement, but it gives fast, queryable spike detection from the same request paths that drive spend.

Known remediation rows whose error starts with `Marked failed during production audit remediation:` are ignored by the failed-refresh check; they remain in history without paging future checks.

If an alert fires repeatedly for a known incident, either fix the underlying production state or temporarily adjust thresholds. Do not silence stale running refreshes without marking the corresponding `ingestion_log` rows terminal (`failed`, `completed`, or `partial`).
