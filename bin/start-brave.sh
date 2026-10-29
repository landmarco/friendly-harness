#!/usr/bin/env bash
# Launch Brave with its outdated-browser banner suppressed (macOS example).
# Override BRAVE_BIN if your install lives somewhere else.
set -euo pipefail

BRAVE_BIN="${BRAVE_BIN:-/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}"
[[ -x "$BRAVE_BIN" ]] || { echo "Brave not found at $BRAVE_BIN; set BRAVE_BIN." >&2; exit 1; }
exec "$BRAVE_BIN" --simulate-outdated-no-au
