#!/usr/bin/env bash
#
# One-command live demo:
#   1. Starts the mock SP-API server on localhost:9999
#   2. Runs the wizard with --prefilled (reads .env.live)
#   3. Cleans up the mock on exit
#
# Use this for the Saturday stage demo so the audience sees the full wizard
# UX without waiting on real Seller Central round-trips.
#
# Requires: .env.live in the repo root with SP_API_* values pre-populated
# (any plausible-looking values work because we route to the mock).
#
# Usage:  npm run demo

set -euo pipefail

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
PORT="${PORT:-9999}"
TEAL='\033[38;2;6;182;212m'
DIM='\033[2m'
RESET='\033[0m'

if [[ ! -f "$REPO_DIR/.env.live" ]]; then
  printf "${TEAL}✗${RESET} No .env.live found at $REPO_DIR/.env.live\n"
  printf "  Copy .env.live.example to .env.live and edit. Values can be plausible-looking placeholders\n"
  printf "  because the demo routes through the mock SP-API server.\n"
  exit 1
fi

# Free port 9999 if anything is squatting
if lsof -ti :"$PORT" >/dev/null 2>&1; then
  printf "${DIM}Port $PORT is in use — freeing it before starting the mock${RESET}\n"
  lsof -ti :"$PORT" | xargs -I{} kill {} 2>/dev/null || true
  sleep 0.5
fi

printf "${TEAL}→${RESET} Starting mock SP-API on http://localhost:$PORT\n"
PORT="$PORT" npx tsx tools/mock-sp-api.ts > /tmp/aos-mock-demo.log 2>&1 &
MOCK_PID=$!

cleanup() {
  printf "\n${DIM}Stopping mock (PID $MOCK_PID)${RESET}\n"
  kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for mock to be ready
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://localhost:$PORT/sellers/v1/marketplaceParticipations" >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done
printf "${TEAL}✓${RESET} Mock is up\n\n"

MOCK_BASE_URL="http://localhost:$PORT" npx tsx src/wizard/index.ts --prefilled
