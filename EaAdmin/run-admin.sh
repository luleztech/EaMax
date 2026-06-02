#!/usr/bin/env bash
# Run EaAdmin (React Native) on Android.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo ""
echo "EaAdmin = React Native (not Flutter)."
echo "Terminal 1: npm start"
echo "Terminal 2: npm run android"
echo ""
echo "Starting Metro (npm start). In another terminal run: npm run android"
echo ""

exec npm start
