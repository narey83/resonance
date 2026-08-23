#!/bin/bash
# Runs fix-backend-network.sh once at startup, then again after every future
# (re)start of resonance-backend -- covers both `docker compose up` recreates
# AND container restarts triggered by things outside our control, like a
# `docker-ce` package upgrade restarting the whole daemon (which is what
# actually caused this to bite twice on 2026-08-23).
#
# Runs as resonance-backend-netfix.service (see resonance-backend-netfix.service
# in this directory) on the dev server, not from this repo checkout directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/fix-backend-network.sh" || true

docker events --filter 'container=resonance-backend' --filter 'event=start' --format '{{.Time}}' |
while read -r _; do
    # Let the container's network stack finish settling before checking it.
    sleep 3
    "$SCRIPT_DIR/fix-backend-network.sh" || true
done
