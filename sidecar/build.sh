#!/usr/bin/env bash
set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SIDECAR_DIR/.." && pwd)"
TARGET_TRIPLE="${JCC_SIDECAR_TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"

if [[ -z "$TARGET_TRIPLE" ]]; then
  echo "Unable to determine Rust host target; set JCC_SIDECAR_TARGET." >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required to build the locked Python sidecar environment." >&2
  exit 1
fi

BUILD_ROOT="${JCC_SIDECAR_BUILD_ROOT:-${TMPDIR:-/tmp}/jcc-sidecar-build/$TARGET_TRIPLE}"
OUTPUT_DIR="${JCC_SIDECAR_OUTPUT_DIR:-$REPO_ROOT/src-tauri/binaries}"
if [[ "$TARGET_TRIPLE" == *windows* ]]; then
  EXE_SUFFIX="${JCC_SIDECAR_EXE_SUFFIX:-.exe}"
else
  EXE_SUFFIX="${JCC_SIDECAR_EXE_SUFFIX:-}"
fi
DIST_DIR="$BUILD_ROOT/dist"
WORK_DIR="$BUILD_ROOT/work"
SPEC_DIR="$BUILD_ROOT/spec"

mkdir -p "$DIST_DIR" "$WORK_DIR" "$SPEC_DIR" "$OUTPUT_DIR"
export PYINSTALLER_CONFIG_DIR="$BUILD_ROOT/pyinstaller-cache"

cd "$SIDECAR_DIR"
uv run --frozen --group bundle pyinstaller \
  --clean \
  --noconfirm \
  --onefile \
  --name jcc-sidecar \
  --distpath "$DIST_DIR" \
  --workpath "$WORK_DIR" \
  --specpath "$SPEC_DIR" \
  --collect-all playwright \
  --collect-submodules keyring.backends \
  src/main.py

install -m 755 \
  "$DIST_DIR/jcc-sidecar$EXE_SUFFIX" \
  "$OUTPUT_DIR/jcc-sidecar-$TARGET_TRIPLE$EXE_SUFFIX"

echo "$OUTPUT_DIR/jcc-sidecar-$TARGET_TRIPLE$EXE_SUFFIX"
