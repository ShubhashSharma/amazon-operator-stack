#!/usr/bin/env bash
#
# amazon-operator-stack — one-line installer (Mac / Linux).
#
# Thin wrapper around the real wizard. Checks Node, runs npm install,
# then hands off to the Clack-based setup wizard.
#
# Usage:  ./install.sh
#

set -euo pipefail

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TEAL='\033[38;2;6;182;212m'
DIM='\033[2m'
RESET='\033[0m'

printf "\n${TEAL}amazon-operator-stack${RESET} ${DIM}— installer${RESET}\n\n"

# iCloud safety — warn but don't auto-copy
if [[ "$REPO_DIR" == *"Mobile Documents"* ]] || [[ "$REPO_DIR" == *"iCloud"* ]]; then
  printf "${DIM}Heads-up:${RESET} this folder looks like it's inside iCloud Drive.\n"
  printf "iCloud occasionally creates duplicate folders that break Node builds.\n"
  printf "Recommended: clone the repo somewhere outside iCloud (e.g. ~/code/).\n\n"
  read -r -p "Continue anyway? [y/N] " yn
  if [[ "$yn" != "y" && "$yn" != "Y" ]]; then
    echo "Aborted. Move the folder and re-run."
    exit 0
  fi
fi

# Node version check
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install Node 20+ from https://nodejs.org and re-run." >&2
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "✗ Node $(node -v) is too old. Install Node 20+ from https://nodejs.org and re-run." >&2
  exit 1
fi
printf "${TEAL}✓${RESET} Node $(node -v)\n"

# npm install
printf "${TEAL}→${RESET} Installing dependencies...\n"
cd "$REPO_DIR"
npm install --silent

# Hand off to the wizard
printf "\n${TEAL}→${RESET} Starting the setup wizard...\n\n"
npm run setup
