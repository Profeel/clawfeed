#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
ATTEMPTS="${DIGEST_JOB_ATTEMPTS:-3}"
RETRY_DELAY_SECONDS="${DIGEST_JOB_RETRY_DELAY_SECONDS:-120}"
LOCK_FILE="$ROOT_DIR/data/digest-job.lock"
timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }

mkdir -p "$ROOT_DIR/data"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
  printf '[%s] Digest job is already running; skipping overlap.\n' "$(timestamp)"
  exit 0
fi

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  printf '[%s] Digest job attempt %s/%s.\n' "$(timestamp)" "$attempt" "$ATTEMPTS"
  if "$NODE_BIN" "$SCRIPT_DIR/fetch-and-digest.mjs" "$@"; then
    printf '[%s] Digest job completed successfully.\n' "$(timestamp)"
    exit 0
  fi

  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    delay=$((RETRY_DELAY_SECONDS * attempt))
    printf '[%s] Digest job failed; automatic retry in %ss.\n' "$(timestamp)" "$delay" >&2
    sleep "$delay"
  fi
  attempt=$((attempt + 1))
done

printf '[%s] Digest job failed after %s attempts.\n' "$(timestamp)" "$ATTEMPTS" >&2
exit 1
