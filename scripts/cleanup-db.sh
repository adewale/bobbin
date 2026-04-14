#!/bin/bash
set -euo pipefail

# Usage: ./scripts/cleanup-db.sh YOUR_ADMIN_SECRET
#
# One-time cleanup script to remove accumulated orphan topics and stale
# chunk_topics from the production D1 database.
#
# Problem: 434K topic rows accumulated from enrichment v1/v2/v3. Most are
# orphans (no chunk_topics) but some are linked to chunks that were enriched
# at older versions. This script:
#   1. Deletes chunk_topics for chunks with outdated enrichment_version
#   2. Deletes episode_topics for those same episodes
#   3. Deletes all orphan topics (no chunk_topics)
#   4. Reports the cleanup results

if [ -z "${1:-}" ]; then
  echo "Usage: $0 ADMIN_SECRET"
  exit 1
fi

SECRET="$1"
BASE="https://bobbin.adewale-883.workers.dev"
AUTH="Authorization: Bearer $SECRET"

echo "=== Pre-cleanup stats ==="
curl -s -H "$AUTH" "$BASE/api/health" | python3 -m json.tool 2>/dev/null || curl -s -H "$AUTH" "$BASE/api/health"
echo ""

echo "=== Step 1: Delete stale chunk_topics for old-version chunks ==="
RESULT=$(curl -s -m 300 -H "$AUTH" "$BASE/api/cleanup-stale")
echo "  $RESULT"
echo ""

echo "=== Step 2: Run finalization (will delete orphans) ==="
RESULT=$(curl -s -m 300 -H "$AUTH" "$BASE/api/finalize")
echo "  $RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'  {s[\"name\"]}: {s[\"status\"]} ({s.get(\"detail\",\"\")}) [{s[\"duration_ms\"]}ms]') for s in d.get('steps',[])]" 2>/dev/null || echo "  $RESULT"
echo ""

echo "=== Post-cleanup stats ==="
curl -s -H "$AUTH" "$BASE/api/health" | python3 -m json.tool 2>/dev/null || curl -s -H "$AUTH" "$BASE/api/health"
echo ""
echo "Done."
