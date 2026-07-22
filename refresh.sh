#!/bin/bash
# refresh.sh — the Workflows app's trace-digest job. Thin by design: it owns
# only the OPERATIONAL concerns of an unattended run — a single-holder lock so
# cron / run-now / agent-trigger can never overlap, the env the parser needs,
# and a one-line summary to the cron log — then hands the work to parse_runs.py.
#
# It is NOT a security boundary. The parser reads owner chat metadata with the
# service token (an owner JWT on disk) and writes the app's own storage with
# the APP_TOKEN from the environment. Following the Reflection precedent
# (/data/apps/reflection/fetch.sh), the service token is read from disk because
# the app-job-runner env allowlist deliberately excludes it.
#
# Invoked by app-job-runner as: bash refresh.sh <app_id>  (app id is $1, and
# cwd is this script's own directory — /data/apps/workflows).
#
# Exit codes (kept distinct so a caller can tell a real success from a no-op):
#   0  ok             2  app id missing        5  skipped (lock held)
#   3  parser missing            other  parser error (propagated)
set -uo pipefail

APP_ID="${1:-}"
DATA_DIR="${DATA_DIR:-/data}"
API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
STATE_DIR="$SCRIPT_DIR/state"
LOCK="$STATE_DIR/.lock"
LOG="$DATA_DIR/cron-logs/workflows-refresh.log"
PARSER="${WORKFLOWS_PARSER:-$SCRIPT_DIR/parse_runs.py}"

# CLI trace roots the parser reads. Defaulted here (not just inherited) so the
# job runs correctly even when the runner env omits them — same defaults the
# entrypoint exports and Reflection's fetch.sh assumes.
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$DATA_DIR/cli-auth/claude}"
export CODEX_HOME="${CODEX_HOME:-$DATA_DIR/cli-auth/codex}"
export DATA_DIR API_BASE_URL APP_ID
export WORKFLOWS_STATE_DIR="$STATE_DIR"

mkdir -p "$STATE_DIR" "$DATA_DIR/cron-logs"
log() { echo "[$(date -Iseconds)] workflows-refresh: $*" >>"$LOG"; }

if [[ -z "$APP_ID" ]]; then
  log "ERROR no app id passed (\$1); exiting (2)"
  exit 2
fi
if [[ ! -f "$PARSER" ]]; then
  log "ERROR parser not found at $PARSER; exiting (3)"
  exit 3
fi

# --- no-overlap lock (flock) ------------------------------------------------
# fd 9 holds the lock for the life of this process; flock -n fails fast if a
# prior refresh (cron, run-now, or agent-trigger) is still running. Trace
# scanning is budgeted to 10s; bounded metadata reads and storage publication
# can extend total wall time. Skip rather than pile work onto the same cursors.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "another refresh holds the lock; skipping (5)"
  exit 5
fi

log "starting (app_id=$APP_ID)"
SUMMARY="$(python3 "$PARSER" --app-id "$APP_ID" 2>>"$LOG")"
RC=$?
if [[ -n "$SUMMARY" ]]; then
  echo "$SUMMARY"
  log "$SUMMARY"
fi
log "done (rc=$RC)"
exit "$RC"
