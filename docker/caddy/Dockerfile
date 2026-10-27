# Resonance reverse proxy. Caddy + the rate-limit module (not in stock Caddy),
# built with xcaddy. Built once; the Caddyfile is bind-mounted at runtime so
# routing tweaks need only a `caddy reload`, not an image rebuild.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit --with github.com/caddy-dns/duckdns

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Baked in for standalone use; the compose bind-mount overrides it for live edits.
RUN apk add --no-cache python3
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
COPY docker/maintenance/maintenance.py /opt/resonance/maintenance.py
COPY docker/scripts/with-helper.py /opt/resonance/with-helper.py
ENV STATE_DIR=/srv/maintenance MAINTENANCE_LISTEN=127.0.0.1 PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python3", "/opt/resonance/with-helper.py", "caddy"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
