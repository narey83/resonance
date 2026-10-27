# Live-reloading web development image. Source is mounted by compose.local.yml.
FROM node:22
ARG DEV_UID=1000
ARG DEV_GID=1000
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts/apply-node-compat.cjs ./scripts/apply-node-compat.cjs
RUN npm ci && sha256sum package-lock.json > node_modules/.resonance-package-lock \
    && mkdir -p /home/dev /cache/npm \
    && chown -R $DEV_UID:$DEV_GID /src/frontend /home/dev /cache/npm
COPY docker/scripts/frontend-dev.sh /usr/local/bin/resonance-frontend-dev
RUN chmod +x /usr/local/bin/resonance-frontend-dev
ENV HOME=/home/dev NPM_CONFIG_CACHE=/cache/npm
USER $DEV_UID:$DEV_GID
EXPOSE 3000
CMD ["resonance-frontend-dev"]
