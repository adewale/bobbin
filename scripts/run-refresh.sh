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
# Ingest the CURRENT doc (not archives). The doc query param ensures
# we target the right source, not the one with the oldest last_fetched_at.
CURRENT_DOC="1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA"
RESULT=$(curl -s -m 120 -H "$AUTH" "$BASE/api/ingest?limit=100&doc=$CURRENT_DOC")
echo "  $RESULT"
echo ""

echo "=== Step 2: Enrich all unenriched chunks ==="
# Loop until done. Don't exit on "same count twice" — large batches
# legitimately produce the same count (500) across consecutive calls.
TOTAL_ENRICHED=0
for i in $(seq 1 120); do
  RESULT=$(curl -s -m 120 -H "$AUTH" "$BASE/api/enrich?batch=500")
  PROCESSED=$(echo "$RESULT" | grep -o '"chunksProcessed":[0-9]*' | grep -o '[0-9]*' || echo "0")
  COMPLETE=$(echo "$RESULT" | grep -o '"complete":[a-z]*' | grep -o '[a-z]*$' || echo "unknown")
  TOTAL_ENRICHED=$((TOTAL_ENRICHED + PROCESSED))
  echo "  Batch $i: processed=$PROCESSED total=$TOTAL_ENRICHED complete=$COMPLETE"

  if [ "$PROCESSED" = "0" ] || [ "$COMPLETE" = "true" ]; then
    echo "  All chunks enriched ($TOTAL_ENRICHED total)."
    break
  fi
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
