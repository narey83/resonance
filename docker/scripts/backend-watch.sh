#!/bin/sh
# dotnet watch does not reliably forward container stop signals to its app.
set -eu

"$@" &
watcher=$!

shutdown() {
    trap '' TERM INT
    app_pids=$(pgrep -x resonance || true)
    if [ -n "$app_pids" ]; then
        # This container runs one backend; signal the app before its watcher.
        kill -TERM $app_pids 2>/dev/null || true
        while pgrep -x resonance >/dev/null; do
            sleep 0.2
        done
    fi

    # The application has finished draining. The watcher can now exit safely.
    kill -TERM "$watcher" 2>/dev/null || true
    attempts=0
    while kill -0 "$watcher" 2>/dev/null && [ "$attempts" -lt 10 ]; do
        sleep 0.2
        attempts=$((attempts + 1))
    done
    kill -KILL "$watcher" 2>/dev/null || true
    wait "$watcher" 2>/dev/null || true
    exit 0
}

trap shutdown TERM INT
wait "$watcher"
