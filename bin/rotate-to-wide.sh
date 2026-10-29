#!/usr/bin/env bash
# Rotate a display to landscape with displayplacer.
# Find your display id with: displayplacer list
set -euo pipefail
: "${DISPLAYPLACER_ID:?set DISPLAYPLACER_ID (see: displayplacer list)}"

displayplacer "id:$DISPLAYPLACER_ID res:2560x1440 hz:59 color_depth:8 enabled:true scaling:off origin:(0,0) degree:0"
