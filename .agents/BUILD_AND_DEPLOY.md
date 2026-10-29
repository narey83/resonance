# Resonance agent quick start

Use this page to orient yourself before changing, building or deploying Resonance. `AGENTS.md` remains authoritative for safety and host restrictions.

## Current architecture

- Authoritative checkout: `/home/narey/projects/resonance` on `dev-laptop.local` (`192.168.0.80`, SSH alias `lan-server`).
- Live Compose project: `resonance-stack`.
- Runtime containers: `resonance-backend` and `resonance-frontend`.
- `resonance-frontend` contains the compiled web UI, Caddy and maintenance coordination. There is no active standalone `resonance-caddy` container.
- Active Compose layers: `docker/compose.portable.yml`, `docker/compose.host-network.yml` and `docker/compose.tls.yml`.
- Persistent state: `/home/narey/.local/share/resonance-stack`, mounted as `/config` in the backend.
- Live SQLite data is under that state directory's `data/`. Checkout data and migration snapshots are not live data.
- Music is mounted at `/downloads` through the application's existing SMB configuration.
- Mobile is an Expo SDK 57 React Native app with native modules. Expo Go is not a valid test target.

## Hard boundaries

- Never access or administer `resonance-dev` / `192.168.0.254` unless the user explicitly asks. Its SMB service being consumed by the current app does not authorize host access.
- Never use `bin/dev-remote` for the current system. `.dev/config.json` and `docker/REMOTE_DEVELOPMENT.md` describe the historical workflow.
- Preserve uncommitted work, application state, databases, credentials, dependencies and native projects.
- Never print private configuration, credentials, tokens or signed URLs.
- Do not edit mirrored mobile files while a mirror is running.

## Definition of done

A source edit is not complete merely because files changed or static checks passed. Build every affected target and make it available for human testing:

| Changed area | Required human-test result |
| --- | --- |
| `frontend/` only | Production web image rebuilt, live `resonance-frontend` replaced, health checked, and served bundle verified. |
| Backend/server code | Portable backend image rebuilt and live stack updated; API/container health verified. Rebuild the frontend too when the contract or UI changed. |
| `mobile/` TypeScript/styles | Current JS served through Metro to an installed compatible development client, or a new native development build installed when Metro is not the chosen test path. |
| Mobile native dependencies, plugins, permissions or config | New Android/iOS native development build installed; Metro alone is insufficient. |
| Shared API behavior | Server deployed first, then every affected web/mobile client built against it. |

If a platform cannot be built from the current host, say exactly which target remains unavailable and why. Do not describe that target as implemented or ready for testing.

## Web build and deployment

Read `docker/PORTABLE_STACK.md`, then use the supported updater from the authoritative checkout:

```sh
python3 docker/update-frontend.py --quick
```

Use the full updater periodically or when the Caddy build/runtime changed:

```sh
python3 docker/update-frontend.py
```

The updater builds production assets, validates Caddy, replaces only the frontend, health-checks it and rolls back on failure. Inspect the private updater log named in its failure output; do not expose secrets from unrelated private configuration.

After success, verify runtime state:

```sh
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} {{.Image}}' resonance-frontend
```

Confirm a distinctive non-secret string or new asset fingerprint exists under `/srv` in the live container. A browser hard refresh may be needed after a new hashed bundle is deployed.

## Backend and portable-stack deployment

Read `docker/PORTABLE_STACK.md`. Use `docker/bootstrap.py` with the existing private configuration so required environment values, mounts, models and health checks are retained. Do not assemble an ad-hoc `docker compose` command without that generated environment.

For a normal stack rebuild/update:

```sh
python3 docker/bootstrap.py
```

For inspection without changing runtime state:

```sh
python3 docker/bootstrap.py --plan
```

After deployment, verify `resonance-backend` and any rebuilt frontend are running and healthy. Exercise the changed API behavior without printing credentials or response secrets.

## Mobile human-test flow

Read `mobile/AGENTS.md`, the exact Expo 57 documentation, and `mobile/EXPO_GUIDE.md` before editing. Native builds belong on the Mac checkout with its Android SDK/Xcode environment.

Install dependencies and build/install the appropriate development client:

```sh
cd mobile
npm ci
npx expo run:android
# or, on macOS with the intended simulator/device
npx expo run:ios
```

For TypeScript/style-only iteration with a compatible client already installed:

```sh
npx expo start --dev-client
```

Run the documented mobile lint/tests before handoff. Native configuration changes always require `expo run:android` and/or `expo run:ios`; Fast Refresh cannot install native changes.

## Fast decision guide

1. Read `git status --short` and preserve unrelated work.
2. Identify affected targets: web, backend, Android, iOS, or a combination.
3. Implement and run focused checks.
4. Build and deploy/install every affected human-test target.
5. Verify the live artifact, container/app health, and changed behavior.
6. Report exactly what is ready, what was verified, and any platform still blocked.
