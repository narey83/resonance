#!/bin/sh
set -eu
# The dependency volume survives image rebuilds; refresh it only when the lockfile changes.
if ! sha256sum -c node_modules/.resonance-package-lock >/dev/null 2>&1; then
  npm ci
  sha256sum package-lock.json > node_modules/.resonance-package-lock
fi
node scripts/apply-node-compat.cjs
exec npm start
