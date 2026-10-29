#!/usr/bin/env bash
# Resize every image in the current directory to a web-friendly width.
set -euo pipefail

shopt -s nullglob
files=(*.*)
(( ${#files[@]} )) || { echo "No files in this directory." >&2; exit 1; }

for i in "${files[@]}"; do
  printf "Resize %s\n" "$i"
  convert "$i" -resize "1024^>" "resize-$i"
done
