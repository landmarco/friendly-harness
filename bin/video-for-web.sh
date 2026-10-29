#!/usr/bin/env bash
# Compress every MP4 in the current directory to a smaller web version.
set -euo pipefail

shopt -s nullglob
files=(*.mp4)
(( ${#files[@]} )) || { echo "No .mp4 files in this directory." >&2; exit 1; }

for i in "${files[@]}"; do
  ffmpeg -i "$i" -c:a aac -b:a 128k -c:v libx264 -crf 28 \
    -vf "scale='min(-2,iw)':'min(1080,ih)'" "web-$i"
done
