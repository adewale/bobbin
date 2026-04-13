#!/bin/bash
set -euo pipefail

# Usage: ./scripts/run-enrichment.sh YOUR_ADMIN_SECRET [--full]
#
# Runs the enrichment pipeline against the deployed Worker.
# Without --full: enriches only unenriched chunks (incremental).
# With --full: clears all topic assignments and re-enriches everything.
#
# Safe to run multiple times — idempotent at every step.

if [ -z "${1:-}" ]; then
  echo "Usage: $0 ADMIN_SECRET [--full]"
  echo "  --full  Clear all topic assignments and re-enrich from scratch"
  echo ""
  echo "  Get your secret from: npx wrangler secret list"
  echo "  Set it with: npx wrangler secret put ADMIN_SECRET"
  exit 1
fi

SECRET="$1"
FULL="${2:-}"
BASE="https://bobbin.adewale-883.workers.dev"
AUTH="Authorization: Bearer $SECRET"

if [ "$FULL" = "--full" ]; then
  echo "=== FULL RE-ENRICHMENT ==="
  echo "  Clearing all topic assignments..."

  # These run via the Worker's D1 binding, not wrangler CLI
  # We need an endpoint for this. Use enrich with a reset param.
  # For now, use wrangler d1 directly.
  npx wrangler d1 execute bobbin-db --remote --command "DELETE FROM episode_topics" 2>&1 | grep "changes" || true
  npx wrangler d1 execute bobbin-db --remote --command "DELETE FROM chunk_topics" 2>&1 | grep "changes" || true
  npx wrangler d1 execute bobbin-db --remote --command "UPDATE topics SET usage_count = 0, kind = CASE WHEN slug IN (SELECT slug FROM topics WHERE kind = 'entity') THEN 'entity' ELSE 'concept' END" 2>&1 | grep "changes" || true
  echo "  Cleared. All chunks are now unenriched."
  echo ""
fi

echo "=== Step 1: Enrich chunks ==="
echo "  (loops until no more chunks to process)"
PREV_PROCESSED=-1
for i in $(seq 1 60); do
  RESULT=$(curl -s -m 120 -H "$AUTH" "$BASE/api/enrich?batch=500")
  PROCESSED=$(echo "$RESULT" | grep -o '"chunksProcessed":[0-9]*' | grep -o '[0-9]*' || echo "0")
  COMPLETE=$(echo "$RESULT" | grep -o '"complete":[a-z]*' | grep -o '[a-z]*$' || echo "unknown")
  echo "  Batch $i: processed=$PROCESSED complete=$COMPLETE"

  if [ "$PROCESSED" = "0" ] || [ "$COMPLETE" = "true" ]; then
    echo "  All chunks enriched."
    break
  fi

  if [ "$PROCESSED" = "$PREV_PROCESSED" ]; then
    echo "  Same count twice — remaining chunks can't be enriched. Moving on."
    break
  fi
  PREV_PROCESSED="$PROCESSED"
done

echo ""
echo "=== Step 2: Run finalization ==="
echo "  (fast steps inline, slow steps dispatched to queue)"
RESULT=$(curl -s -m 300 -H "$AUTH" "$BASE/api/finalize")
echo "  Result: $RESULT"

echo ""
echo "=== Step 3: Wait for queue consumers ==="
echo "  (n-gram assignment + related_slugs processing in parallel)"
echo "  Waiting 45 seconds..."
sleep 45

echo ""
echo "=== Step 4: Verify ==="

TOPICS=$(curl -s "$BASE/topics" | grep -o 'multiple-name">[^<]*' | sed 's/multiple-name">//' | head -20)
echo "  Topics grid:"
echo "$TOPICS" | sed 's/^/    /'

echo ""
HOMEPAGE=$(curl -s "$BASE/" | grep -o '"topic">[^<]*' | sed 's/"topic">//' | head -10)
echo "  Homepage Popular Topics:"
echo "$HOMEPAGE" | sed 's/^/    /'

echo ""
echo "Done. Check: $BASE/topics"
