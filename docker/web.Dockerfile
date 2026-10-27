# Production image for the Resonance web UI — static build served by Caddy.
# API/hub routing to the backend is the reverse proxy's job, not this image's.
# Build from the repo root: docker build -f docker/web.Dockerfile .

FROM node:22 AS build
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts/apply-node-compat.cjs ./scripts/apply-node-compat.cjs
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM caddy:2
RUN apk add --no-cache python3
COPY docker/maintenance/maintenance.py /opt/resonance/maintenance.py
COPY docker/scripts/with-helper.py /opt/resonance/with-helper.py
ENV STATE_DIR=/data/maintenance MAINTENANCE_LISTEN=127.0.0.1 PYTHONDONTWRITEBYTECODE=1
ARG CADDYFILE=docker/caddy/Caddyfile.web
COPY ${CADDYFILE} /etc/caddy/Caddyfile
COPY --from=build /web/build /srv
EXPOSE 80

ENTRYPOINT ["python3", "/opt/resonance/with-helper.py", "caddy"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
