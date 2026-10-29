#!/usr/bin/env bash
# Rotate a display to portrait with displayplacer.
# Find your display id with: displayplacer list
set -euo pipefail
: "${DISPLAYPLACER_ID:?set DISPLAYPLACER_ID (see: displayplacer list)}"

displayplacer "id:$DISPLAYPLACER_ID res:1440x2560 hz:59 color_depth:4 enabled:true scaling:off origin:(0,0) degree:90"
