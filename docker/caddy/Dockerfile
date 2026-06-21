# Resonance reverse proxy. Caddy + the rate-limit module (not in stock Caddy),
# built with xcaddy. Built once; the Caddyfile is bind-mounted at runtime so
# routing tweaks need only a `caddy reload`, not an image rebuild.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Baked in for standalone use; the compose bind-mount overrides it for live edits.
COPY Caddyfile /etc/caddy/Caddyfile
