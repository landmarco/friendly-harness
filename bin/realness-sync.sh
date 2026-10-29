#!/usr/bin/env bash
# Copy a source bucket's people/ tree into a destination bucket.
# This is an example ops helper; set the bucket names in your environment.
#
#   REALNESS_SRC_BUCKET=gs://my-app REALNESS_DST_BUCKET=gs://my-app-staging ./bin/realness-sync.sh
#
# For a single person, additionally set REALNESS_PERSON_ID and run the
# commented block at the bottom.

set -euo pipefail

: "${REALNESS_SRC_BUCKET:?set REALNESS_SRC_BUCKET (for example gs://my-app)}"
: "${REALNESS_DST_BUCKET:?set REALNESS_DST_BUCKET (for example gs://my-app-staging)}"

command -v gsutil >/dev/null 2>&1 || {
  echo "gsutil not found; install the Google Cloud CLI first." >&2
  exit 1
}

PERSON_ID="${REALNESS_PERSON_ID:-}"

# Reset the destination people/ tree from the source.
gsutil -m -o GSUtil:parallel_process_count=1 rm -r "$REALNESS_DST_BUCKET/people" || true
gsutil -m -o GSUtil:parallel_process_count=1 cp -R "$REALNESS_SRC_BUCKET/people/" "$REALNESS_DST_BUCKET/"

# Single person only:
# [[ -n "$PERSON_ID" ]] || { echo "Set REALNESS_PERSON_ID for a single-person copy." >&2; exit 1; }
# gsutil -m rm -r "$REALNESS_DST_BUCKET/people/$PERSON_ID"
# gsutil -m cp -R "$REALNESS_SRC_BUCKET/people/$PERSON_ID" "$REALNESS_DST_BUCKET/people"
