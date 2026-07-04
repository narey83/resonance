# Production image for the Resonance web UI — static build served by Caddy.
# API/hub routing to the backend is the reverse proxy's job, not this image's.
# Build from the repo root: docker build -f docker/web.Dockerfile .

FROM node:22 AS build
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM caddy:2
COPY docker/caddy/Caddyfile.web /etc/caddy/Caddyfile
COPY --from=build /web/build /srv
EXPOSE 80
