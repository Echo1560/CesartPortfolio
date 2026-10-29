#!/usr/bin/env bash
# Reports publish progress to the `publish-status` Edge Function.
#   report-publish-status.sh <building|succeeded|failed> [error message]
# Env: SB_URL, STATUS_TOKEN (secrets), RUN_ID (from the dispatch payload), RUN_URL.
# Never fails the workflow: a reporting problem is a warning. The token is never printed.
set -u
status="$1"; error="${2:-}"

if [ -z "${SB_URL:-}" ] || [ -z "${STATUS_TOKEN:-}" ] || [ -z "${RUN_ID:-}" ]; then
  echo "::warning title=publish-status::SUPABASE_URL, PUBLISH_STATUS_TOKEN or run_id missing; not reporting '$status'."
  exit 0
fi
echo "::add-mask::$STATUS_TOKEN"

body=$(jq -nc --arg run_id "$RUN_ID" --arg status "$status" --arg url "$RUN_URL" --arg error "$error" \
  '{run_id: $run_id, status: $status, github_run_url: $url} + (if $error != "" then {error: $error} else {} end)')

out=$(mktemp)
code=$(curl -sS -o "$out" -w '%{http_code}' --max-time 20 -X POST \
  -H "x-publish-token: $STATUS_TOKEN" -H "content-type: application/json" -d "$body" \
  "${SB_URL%/}/functions/v1/publish-status") || code=000

case "$code" in
  200) echo "publish-status: reported '$status'" ;;
  409) echo "publish-status: run already finished; '$status' ignored" ;;
  *)   echo "::warning title=publish-status::reporting '$status' answered HTTP $code: $(head -c 200 "$out")" ;;
esac
exit 0
