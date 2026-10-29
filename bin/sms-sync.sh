#!/usr/bin/env bash
# Copy a Google Cloud Storage app bucket into a staging bucket.
# This is an example ops helper; set the bucket names in your environment.
#
#   SMS_SRC_BUCKET=gs://my-app SMS_DST_BUCKET=gs://my-app-staging ./bin/sms-sync.sh

set -euo pipefail

: "${SMS_SRC_BUCKET:?set SMS_SRC_BUCKET (for example gs://my-app)}"
: "${SMS_DST_BUCKET:?set SMS_DST_BUCKET (for example gs://my-app-staging)}"

command -v gsutil >/dev/null 2>&1 || {
  echo "gsutil not found; install the Google Cloud CLI first." >&2
  exit 1
}

gsutil -m -o GSUtil:parallel_process_count=1 cp -R "$SMS_SRC_BUCKET" "$SMS_DST_BUCKET"
