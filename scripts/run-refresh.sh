#!/bin/bash
set -euo pipefail

# Usage: ./scripts/run-refresh.sh YOUR_ADMIN_SECRET
#
# Does exactly what the Monday cron does:
#   1. Fetch new content from Google Docs
#   2. Parse and ingest new episodes
#   3. Enrich all unenriched chunks
#   4. Run finalization (queue dispatch for n-grams + related_slugs)
#
# Use this to pre-verify cron behavior or to trigger a manual refresh.

if [ -z "${1:-}" ]; then
  echo "Usage: $0 ADMIN_SECRET"
  exit 1
fi

SECRET="$1"
BASE="https://bobbin.adewale-883.workers.dev"
AUTH="Authorization: Bearer $SECRET"

echo "=== Step 1: Fetch + parse + ingest new episodes ==="
# The /api/ingest endpoint fetches the Google Doc, parses it,
# and inserts any new episodes (skips existing dates).
# limit=100 to ingest all new episodes in one call.
RESULT=$(curl -s -m 120 -H "$AUTH" "$BASE/api/ingest?limit=100")
echo "  $RESULT"
echo ""

echo "=== Step 2: Enrich all unenriched chunks ==="
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
    echo "  Same count twice — remaining chunks can't produce topics. Moving on."
    break
  fi
  PREV_PROCESSED="$PROCESSED"
done
echo ""

echo "=== Step 3: Finalize (n-grams + related_slugs via queue) ==="
RESULT=$(curl -s -m 300 -H "$AUTH" "$BASE/api/finalize")
echo "  $RESULT"
echo ""

echo "=== Step 4: Wait for queue consumers (30s) ==="
sleep 30

echo "=== Step 5: Verify ==="
HEALTH=$(curl -s -H "$AUTH" "$BASE/api/health")
echo "  Health: $HEALTH"
echo ""

LATEST=$(curl -s "$BASE/" | grep -o 'Latest:[^<]*' | head -1)
echo "  Homepage: $LATEST"

TOPICS=$(curl -s "$BASE/topics" | grep -o 'multiple-name">[^<]*' | sed 's/multiple-name">//' | head -10)
echo "  Top 10 topics:"
echo "$TOPICS" | sed 's/^/    /'

echo ""
echo "Done. Check: $BASE"
