# Resonance dev stack (Docker)

For a new Linux host, start with the [portable SMB-backed stack](PORTABLE_STACK.md): `python3 docker/bootstrap.py` from the repository root. It uses local SQLite and does not require the legacy development networks or PostgreSQL defaults below.

Local live development uses `compose.local.yml`. The older server stack below
replaces the `resonance-backend` / `resonance-frontend` systemd services. Source is bind-mounted and the containers run the same
hot-reload commands (`dotnet watch` / `npm start`), so **editing code never
rebuilds an image** — `dotnet watch` recompiles and craco HMRs in place.

For the shared Linux dev server and VS Code Remote SSH workflow, see [Remote development](REMOTE_DEVELOPMENT.md).

## Local development on this Mac or Linux

Use the portable stack in `compose.local.yml`. It does not need the external networks, PostgreSQL instance or server-specific music paths used by the older server stack below.

```sh
./bin/dev-container build
./bin/dev-container start
./bin/dev-container status
./bin/dev-container logs backend
./bin/dev-container restart web
./bin/dev-container stop
```

Defaults are `http://localhost:3001` for the web UI and `http://127.0.0.1:55451` for the API. Ports, Docker context and initial Soulseek connection are stored in ignored `.dev/docker/config.json`. The first test instance keeps Soulseek disconnected to avoid logging out a running native server. Once this workspace is switched over, the config uses the original 3000/55450 ports and enables Soulseek; the native data remains available as a rollback copy.

The local containers run with your numeric user/group IDs so bind-mounted files remain writable from the host.

Backend C# edits trigger a clean `dotnet watch` restart, and web edits use React live reload. Source is bind-mounted; .NET build output, NuGet packages and Linux `node_modules` use separate named volumes. No image rebuild is needed for ordinary code edits. Restart `web` after package-lock changes; its entrypoint refreshes dependencies only when the lockfile changes. Rebuild for Dockerfile/toolchain changes. The first ARM64 build compiles a pinned, checksum-verified Essentia source revision because PyPI has no Linux ARM64 wheel; subsequent builds reuse that cached layer.

App data lives in `.dev/docker/app` and survives stops/restarts. `import-native` copies a consistent SQLite snapshot from `.dev/app` while Docker is stopped, preserving any previous Docker app directory as a backup. Stop the native backend before importing for a final cutover snapshot. It does not delete or modify the native data. Keep the app directory and named volumes when recreating containers.

On this Mac the dedicated Colima profile is `resonance-dev` (2 CPUs, 4 GiB RAM). `start` also starts this VM when needed. Docker Desktop or a Linux engine can be used by changing `context` in the local config. After the cutover, `.dev/config.json` has `serverRuntime: "docker"`, so the existing `bin/dev start/stop/restart/status` commands manage these containers and still manage Expo Metro on the host for iOS/Android simulators.

## Verification and rollback

The local Linux ARM64 stack was exercised with 291 passing backend tests (one PostgreSQL check skipped), all 478 web tests passing, actual Essentia key detection, live source reload, preserved authentication and an offline first boot. Web builds retain existing source-map/deprecation warnings. Run the full web suite separately from the servers on the 4 GiB VM:

```sh
./bin/dev-container stop
# Use the configured Docker context; the manager sets it for its own commands.
DOCKER_CONTEXT=colima-resonance-dev LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) \
  docker compose -f docker/compose.local.yml run --rm --no-deps web \
  npm run test-unattended -- --runInBand
./bin/dev-container start
```

To return this workspace to native development: stop Docker, remove `serverRuntime` from `.dev/config.json`, then run `./bin/dev start`. The untouched `.dev/app` is the native rollback snapshot; later Docker-only data is under `.dev/docker/app`. Do not run both servers against the same SQLite directory.

## Older server stack

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
`/mnt/data/containers/resonance/` and it appears as a stack. (Stacks moved there
from `/home/narey/containers/`; that is where the server's live copy of this
compose file sits.)

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

## Media tool dependencies

Both backend images bundle yt-dlp, Deno, FFmpeg and ffprobe for Linux amd64/arm64. The image build downloads standalone upstream release assets, verifies their published SHA-256 digests, checks that each tool runs, and retains license/source information. No Homebrew, root access or package installation is needed during app startup.

On first startup the app verifies and copies the bundled tools into `data/bin` beneath `RESONANCE_APP_DIR`. This makes first startup work offline. The dev compose stack already persists that app directory. The production image uses `/config`; attach a persistent volume there and give the container user write access:

```sh
docker build -f docker/prod.Dockerfile -t resonance-backend .
docker run --name resonance-backend -v resonance-config:/config -p 5030:5030 resonance-backend
```

Managed yt-dlp and Deno check for updates on startup and every `integrations.yt_dlp.update_interval_days` (default 3), controlled by `integrations.yt_dlp.auto_update`. Managed FFmpeg/ffprobe use `ffmpeg.auto_update` and `ffmpeg.update_interval_days` (default 7). Both auto-update flags default to true. Failed downloads/checksums leave installed copies available; first-run setup failures appear in startup status and retry in the background. System packages and explicitly configured external binaries are never automatically replaced.

Rebuilding an image refreshes its bundled tools. Pin image-build versions with `--build-arg YTDLP_VERSION=... --build-arg DENO_VERSION=... --build-arg FFMPEG_VERSION=...` using upstream release tags. Runtime updates stay in the volume and survive image/container recreation. Rebuild the backend image once to add this provisioning layer; restarting an old image cannot add bundled tools.
