#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
pip install -e . pyinstaller
pyinstaller --onefile --name jcc-sidecar src/main.py
cp dist/jcc-sidecar ../src-tauri/binaries/jcc-sidecar-aarch64-apple-darwin
