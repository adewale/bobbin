#!/bin/bash
set -euo pipefail

# Usage: ./scripts/run-enrichment.sh YOUR_ADMIN_SECRET
#
# Runs the full enrichment pipeline against the deployed Worker.
# Safe to run multiple times — idempotent at every step.
# Handles: out-of-order runs, partial completions, stale data.

if [ -z "${1:-}" ]; then
  echo "Usage: $0 ADMIN_SECRET"
  echo "  Get your secret from: npx wrangler secret list"
  echo "  Set it with: npx wrangler secret put ADMIN_SECRET"
  exit 1
fi

SECRET="$1"
BASE="https://bobbin.adewale-883.workers.dev"
AUTH="Authorization: Bearer $SECRET"

echo "=== Step 1: Enrich all unenriched chunks ==="
echo "  (loops until no more chunks to process)"
PREV_PROCESSED=-1
for i in $(seq 1 20); do
  RESULT=$(curl -s -m 120 -H "$AUTH" "$BASE/api/enrich?batch=500")
  PROCESSED=$(echo "$RESULT" | grep -o '"chunksProcessed":[0-9]*' | grep -o '[0-9]*' || echo "0")
  COMPLETE=$(echo "$RESULT" | grep -o '"complete":[a-z]*' | grep -o '[a-z]*$' || echo "unknown")
  echo "  Batch $i: processed=$PROCESSED complete=$COMPLETE"

  if [ "$PROCESSED" = "0" ] || [ "$COMPLETE" = "true" ]; then
    echo "  All chunks enriched."
    break
  fi

  # Stop if we keep processing the same number (stuck chunks with no topics)
  if [ "$PROCESSED" = "$PREV_PROCESSED" ]; then
    echo "  Same count twice — remaining chunks produce no topics. Moving on."
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
sleep 30

echo ""
echo "=== Step 4: Verify ==="
echo "  Checking production state..."
echo ""

# Quick health check via the topics page
TOPICS=$(curl -s "$BASE/topics" | grep -o 'multiple-name">[^<]*' | sed 's/multiple-name">//' | head -20)
TOPIC_COUNT=$(echo "$TOPICS" | wc -l | tr -d ' ')
echo "  Topics grid ($TOPIC_COUNT topics):"
echo "$TOPICS" | sed 's/^/    /'

echo ""
echo "Done. Check the site: $BASE/topics"
