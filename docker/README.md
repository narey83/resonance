# Resonance dev stack (Docker)

Containerised replacement for the `resonance-backend` / `resonance-frontend`
systemd services. Source is bind-mounted and the containers run the same
hot-reload commands (`dotnet watch` / `npm start`), so **editing code never
rebuilds an image** — `dotnet watch` recompiles and craco HMRs in place.

## What's in the stack

| Service    | Image                              | Port (host net) | Reload |
| ---------- | ---------------------------------- | --------------- | ------ |
| `backend`  | `resonance-backend-dev` (SDK+ffmpeg) | 5030, 50300, 8300 | `dotnet watch` |
| `frontend` | `node:22`                          | 3000            | craco HMR |

Postgres (`postgres-db`) and Caddy are **not** in this stack — they're shared
infra and keep running as-is. Host networking means the DB connection string
(`Host=localhost`), craco's proxy target (`localhost:5030`), and Caddy's
upstreams (`192.168.0.254:5030` / `:3000`) all keep working untouched.

## Run it

```bash
# On the server (192.168.0.254). Source is read from $RESONANCE_SRC
# (default /home/narey/projects/resonance).
docker compose -f docker-compose.yml up -d --build      # first time (builds backend image)
docker compose -f docker-compose.yml up -d              # subsequently (no rebuild)
docker compose logs -f backend
```

To manage it from Dockge, copy this directory to
`/home/narey/containers/resonance/` and it appears as a stack.

## Cutover from systemd

The systemd services own host ports 5030/3000, so stop them before starting the
stack:

```bash
systemctl --user stop resonance-frontend resonance-backend
systemctl --user disable resonance-frontend resonance-backend   # optional
docker compose -f docker-compose.yml up -d --build
```

To roll back: `docker compose down` then
`systemctl --user start resonance-backend resonance-frontend`.

## Notes

- First `--build` installs ffmpeg into the image; first `up` runs `npm install`
  and a full `dotnet restore` (slow once, cached in named volumes after).
- This is a **dev** stack using stock SDK/node images with bind-mounted source.
  It does not build or publish a Resonance container image, so the AGPL
  Additional-Terms OCI annotations (`org.opencontainers.image.licenses=AGPL-3.0-only`,
  `…image.source`) are **not** required here — add them when/if a production
  image is built and published.
