#!/usr/bin/env bash
# Run EaMax user app on Chrome without DWDS debugger timeout (release mode).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Kill stale Flutter Chrome debug sessions that block new connections.
pkill -f 'chrome.*flutter_tools' 2>/dev/null || true
pkill -f 'google-chrome.*--user-data-dir=.*flutter' 2>/dev/null || true

echo "Running EaMax (Flutter) on Chrome — release mode (stable, no debugger attach)."
echo "For debug/hot reload, try: flutter run -d linux"
echo ""

exec flutter run -d chrome --release \
  --web-browser-flag=--disable-extensions \
  --web-browser-flag=--no-first-run \
  "$@"
