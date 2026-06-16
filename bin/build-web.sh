#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/frontend"
WWWROOT_SRC="$ROOT/backend/wwwroot"
WWWROOT_BIN="$ROOT/backend/bin/Debug/net10.0/wwwroot"

echo "Building frontend..."
cd "$WEB"
DISABLE_ESLINT_PLUGIN=true npm run build

echo "Copying to $WWWROOT_SRC"
cp -r "$WEB/build/." "$WWWROOT_SRC/"

echo "Copying to $WWWROOT_BIN"
mkdir -p "$WWWROOT_BIN"
cp -r "$WEB/build/." "$WWWROOT_BIN/"

echo "Frontend build deployed ($(ls "$WEB/build/static/js"/main.*.js | xargs basename))."
