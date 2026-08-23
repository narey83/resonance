#!/bin/bash
# Idempotent fixup for the Compose gw_priority bug (see docker-compose.yml comments):
# Compose parses gw_priority but never applies it to the container, so Docker's own
# tiebreak picks a network to be "primary" -- and has consistently picked local_lan_net
# (a macvlan), which breaks the 50300 port publish entirely since Docker can't
# implement published ports over a macvlan. This reapplies the intended priorities
# (resonance_backend_net highest, local_lan_net lowest) whenever they've drifted.
#
# Safe to run any time; it's a no-op when the default route is already correct.
#
# Deployed alongside fix-backend-network-watch.sh and resonance-backend-netfix.service
# (see docker/scripts/resonance-backend-netfix.service) as a systemd unit on the dev
# server, which reapplies this automatically after every backend container (re)start --
# not just `docker compose up` recreates, but also restarts triggered by things outside
# our control, like a docker-ce package upgrade restarting the whole daemon.
set -euo pipefail

CONTAINER=resonance-backend
# 172.20.0.1 (resonance_backend_net's gateway), as little-endian hex from /proc/net/route.
EXPECTED_GW_HEX="010014AC"

current_gw=$(docker exec "$CONTAINER" sh -c "awk '\$2==\"00000000\" {print \$3; exit}' /proc/net/route" 2>/dev/null || echo "")

if [ "$current_gw" = "$EXPECTED_GW_HEX" ]; then
    echo "$(date -u +%FT%TZ) OK: $CONTAINER default route already via resonance_backend_net"
    exit 0
fi

if [ -z "$current_gw" ]; then
    echo "$(date -u +%FT%TZ) $CONTAINER not running or not reachable, skipping"
    exit 0
fi

echo "$(date -u +%FT%TZ) Fixing: $CONTAINER default route gw hex was '$current_gw', expected '$EXPECTED_GW_HEX' (resonance_backend_net)"

docker network disconnect resonance_backend_net "$CONTAINER" 2>/dev/null || true
docker network connect --ip 172.20.0.5 --gw-priority 100 resonance_backend_net "$CONTAINER"

docker network disconnect local_lan_net "$CONTAINER" 2>/dev/null || true
docker network connect --ip 192.168.0.33 --gw-priority -100 local_lan_net "$CONTAINER"

echo "$(date -u +%FT%TZ) Fixed. New default route:"
docker exec "$CONTAINER" sh -c "awk 'NR==1 || \$2==\"00000000\"' /proc/net/route"
