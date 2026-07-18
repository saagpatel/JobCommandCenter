#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/path/to/app-executable" >&2
  exit 2
fi

APP_EXECUTABLE="$1"
if [[ "$APP_EXECUTABLE" != /* || ! -x "$APP_EXECUTABLE" ]]; then
  echo "App executable must be an absolute executable path: $APP_EXECUTABLE" >&2
  exit 2
fi

REAL_HOME="${HOME:?HOME must be set}"
INSTALLED_DB_DIR="${JCC_INSTALLED_DB_DIR:-$REAL_HOME/Library/Application Support/com.jcc.app}"
SMOKE_PARENT="${JCC_SMOKE_ROOT:-${TMPDIR:-/tmp}}"
HOLD_SECONDS="${JCC_SMOKE_HOLD_SECONDS:-7}"
REQUIRE_SIDECAR="${JCC_SMOKE_REQUIRE_SIDECAR:-0}"
RESTART_SIDECAR="${JCC_SMOKE_RESTART_SIDECAR:-0}"
SIDECAR_WAIT_SECONDS="${JCC_SMOKE_SIDECAR_WAIT_SECONDS:-35}"
if [[ ! "$HOLD_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "JCC_SMOKE_HOLD_SECONDS must be a non-negative integer." >&2
  exit 2
fi
for value_name in REQUIRE_SIDECAR RESTART_SIDECAR; do
  value="${!value_name}"
  if [[ "$value" != "0" && "$value" != "1" ]]; then
    echo "JCC_SMOKE_${value_name} must be 0 or 1." >&2
    exit 2
  fi
done
if [[ ! "$SIDECAR_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "JCC_SMOKE_SIDECAR_WAIT_SECONDS must be a positive integer." >&2
  exit 2
fi
if [[ "$RESTART_SIDECAR" == "1" ]]; then
  REQUIRE_SIDECAR="1"
fi
if [[ "$REQUIRE_SIDECAR" == "1" ]]; then
  for command in curl lsof ps; do
    if ! command -v "$command" >/dev/null 2>&1; then
      echo "$command is required for sidecar lifecycle smoke." >&2
      exit 2
    fi
  done
  if lsof -tiTCP:9876 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 9876 is already occupied; refusing to adopt an unrelated sidecar." >&2
    exit 1
  fi
fi

mkdir -p "$SMOKE_PARENT"
SMOKE_HOME="$(mktemp -d "$SMOKE_PARENT/jcc-disposable-smoke.XXXXXX")"
BEFORE_FINGERPRINT="$SMOKE_HOME/installed-before.sha256"
AFTER_FINGERPRINT="$SMOKE_HOME/installed-after.sha256"
SMOKE_DB="$SMOKE_HOME/Library/Application Support/com.jcc.app/jcc.db"
APP_LOG="$SMOKE_HOME/app.log"
APP_PID=""

fingerprint_installed_database() {
  local output="$1"
  : >"$output"
  for file in "$INSTALLED_DB_DIR"/jcc.db*; do
    if [[ -f "$file" ]]; then
      shasum -a 256 "$file" >>"$output"
    fi
  done
}

stop_app() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  APP_PID=""
}
trap stop_app EXIT INT TERM

wait_for_sidecar_health() {
  local excluded_pid="${1:-}"
  local listener_pid=""

  for ((i = 0; i < SIDECAR_WAIT_SECONDS; i++)); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "App exited while waiting for sidecar health." >&2
      tail -n 80 "$APP_LOG" >&2 || true
      return 1
    fi

    listener_pid="$(lsof -tiTCP:9876 -sTCP:LISTEN 2>/dev/null | head -n 1)"
    if [[ -n "$listener_pid" && "$listener_pid" != "$excluded_pid" ]] \
      && curl --fail --silent --show-error --noproxy '*' \
        --max-time 2 http://127.0.0.1:9876/health >/dev/null; then
      printf '%s\n' "$listener_pid"
      return 0
    fi
    sleep 1
  done

  echo "Sidecar did not become healthy within ${SIDECAR_WAIT_SECONDS}s." >&2
  tail -n 80 "$APP_LOG" >&2 || true
  return 1
}

fingerprint_installed_database "$BEFORE_FINGERPRINT"

env \
  HOME="$SMOKE_HOME" \
  HTTPS_PROXY="http://127.0.0.1:9" \
  HTTP_PROXY="http://127.0.0.1:9" \
  ALL_PROXY="http://127.0.0.1:9" \
  NO_PROXY="127.0.0.1,localhost" \
  "$APP_EXECUTABLE" >"$APP_LOG" 2>&1 &
APP_PID="$!"

for _ in $(seq 1 20); do
  if [[ -f "$SMOKE_DB" ]]; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    wait "$APP_PID"
    echo "App exited before creating the disposable database." >&2
    exit 1
  fi
  sleep 1
done

if [[ ! -f "$SMOKE_DB" ]]; then
  echo "Disposable database was not created within 20 seconds." >&2
  tail -n 80 "$APP_LOG" >&2 || true
  exit 1
fi

if [[ "$REQUIRE_SIDECAR" == "1" ]]; then
  INITIAL_SIDECAR_PID="$(wait_for_sidecar_health)"
  EXPECTED_SIDECAR="$(
    cd "$(dirname "$APP_EXECUTABLE")"
    pwd
  )/jcc-sidecar"
  ACTUAL_SIDECAR="$(ps -p "$INITIAL_SIDECAR_PID" -o command=)"
  if [[ "$ACTUAL_SIDECAR" != "$EXPECTED_SIDECAR" ]]; then
    echo "Healthy listener is not the bundled sidecar: $ACTUAL_SIDECAR" >&2
    exit 1
  fi
fi

if [[ "$RESTART_SIDECAR" == "1" ]]; then
  kill "$INITIAL_SIDECAR_PID"
  RECOVERED_SIDECAR_PID="$(wait_for_sidecar_health "$INITIAL_SIDECAR_PID")"
  if ! grep -Fq "Attempting sidecar restart (1/3)" "$APP_LOG"; then
    echo "Sidecar recovered without the expected bounded restart receipt." >&2
    tail -n 80 "$APP_LOG" >&2 || true
    exit 1
  fi
fi

for ((i = 0; i < HOLD_SECONDS; i++)); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    wait "$APP_PID"
    echo "App exited during the smoke hold." >&2
    tail -n 80 "$APP_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

stop_app
if [[ "$REQUIRE_SIDECAR" == "1" ]]; then
  for ((i = 0; i < 10; i++)); do
    if ! lsof -tiTCP:9876 -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if lsof -tiTCP:9876 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Sidecar listener remained after app shutdown." >&2
    lsof -nP -iTCP:9876 -sTCP:LISTEN >&2 || true
    exit 1
  fi
fi

QUICK_CHECK="$(sqlite3 "$SMOKE_DB" "PRAGMA quick_check;")"
SCHEMA_VERSION="$(sqlite3 "$SMOKE_DB" "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;")"
if [[ "$QUICK_CHECK" != "ok" ]]; then
  echo "Disposable database quick_check failed: $QUICK_CHECK" >&2
  exit 1
fi

fingerprint_installed_database "$AFTER_FINGERPRINT"
if ! cmp -s "$BEFORE_FINGERPRINT" "$AFTER_FINGERPRINT"; then
  echo "Installed database sidecars changed during disposable smoke:" >&2
  diff -u "$BEFORE_FINGERPRINT" "$AFTER_FINGERPRINT" >&2 || true
  exit 1
fi

echo "Disposable release smoke passed."
echo "Schema version: $SCHEMA_VERSION"
if [[ "$REQUIRE_SIDECAR" == "1" ]]; then
  echo "Initial sidecar PID: $INITIAL_SIDECAR_PID"
fi
if [[ "$RESTART_SIDECAR" == "1" ]]; then
  echo "Recovered sidecar PID: $RECOVERED_SIDECAR_PID"
fi
echo "Disposable home retained at: $SMOKE_HOME"
