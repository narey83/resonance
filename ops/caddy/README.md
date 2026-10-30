# Caddy site availability

Caddy owns web availability and serves an independent status page before React loads. It probes the backend's `/health/ready` endpoint before forwarding a request. The endpoint reports core and database readiness without exposing internal diagnostics. Background analysis, share scans and optional tools do not hold the site closed.

The React app no longer polls `/startup` or `/maintenance/status` or renders the startup panel. An already-open app follows Caddy's explicitly classified `503` responses by reloading its existing URL. A disconnected application hub also checks Caddy once per existing reconnect attempt. The independent status page checks Caddy every five seconds and reloads when Caddy reports readiness. Sign-in storage is retained. Local network failures still use the application's connection screen because an unreachable Caddy cannot serve a page.

## Status contract

`GET /__site/status` is the public site check. It includes `Cache-Control: no-store`, `X-Resonance-Gateway: caddy` and `X-Resonance-Site-State`.

| HTTP | State | Meaning |
| --- | --- | --- |
| 200 | available | Core services, databases and the web entry point are ready. |
| 200 | degraded | The site is usable; an optional background service failed. |
| 503 | maintenance | An operator deliberately closed the site. |
| 503 | restarting | An explicit restart marker exists, or the backend reports shutdown. |
| 503 | starting | The backend is responding but required initialization is unfinished. |
| 503 | unavailable | The backend cannot be reached or its readiness contract is invalid. |
| 503 | frontend-unavailable | The backend is ready but the web entry point is missing. |

All unavailable responses include `Retry-After: 5`. Navigation receives HTML from `status/`; API, hub and status requests receive JSON with `ready`, `state`, `code` and `retryAfter`. A real API `401`, `404` or business-level `503` is preserved. Existing native clients also receive `X-Resonance-Maintenance: true` for planned maintenance and restarts. A missing web build does not disable otherwise healthy native API clients.

`/__site/readiness` reports underlying readiness while ignoring the two planned override markers. It returns only health metadata and never bypasses maintenance for API or web requests. Deployment scripts can use it to wait for the new process while the public site continues to show “restarting.”

`/__site/live` reports Caddy liveness independently of the application. Backend `/health` retains its existing liveness semantics; `/health/ready` is the new readiness contract. The latter returns `503` when core services or a registered database are starting or failed, and during shutdown. No accounts need to exist for the site to become ready, so first-time setup remains accessible.

## Native configuration

Use Caddy 2.11.7 or a compatible version. The routing uses standard Caddy modules. Keep the existing TLS/DuckDNS modules, credentials, logging filters, listeners and proxy security settings. Historical files under `docker/` describe a different runtime; this configuration does not require Docker.

Copy `site.caddy` and `status/` to a stable directory outside the frontend build and backend release directories. Provide these environment variables to the existing Caddy process:

```sh
RESONANCE_BACKEND_UPSTREAM=127.0.0.1:55450
RESONANCE_WEB_ROOT=/absolute/path/to/complete/frontend/build
RESONANCE_STATUS_ROOT=/absolute/path/to/gateway/status
RESONANCE_SITE_STATE_ROOT=/absolute/path/to/gateway/state
```

The backend address defaults to `127.0.0.1:55450`. All three filesystem paths are required. Caddy needs read access to the build, status pages and marker directory. Only the deployment operator needs write access to the markers. This template assumes the application is mounted at the domain root.

Import `site.caddy` at the top level of the existing Caddyfile, then import `resonance_site` directly inside each application site block, replacing its old API/hub/static routing. `Caddyfile.example` demonstrates the placement with a local hostname. Keep the current deployment's HTTPS site address and certificate configuration when adopting it.

Validate and reload using the existing Caddy binary and service environment:

```sh
caddy validate --config /path/to/Caddyfile --adapter caddyfile
caddy reload --config /path/to/Caddyfile --adapter caddyfile
```

Deploy the backend readiness endpoint and the complete frontend build before activating the gateway configuration. Until the endpoint exists, Caddy deliberately fails closed. Publish frontend builds as complete releases before switching Caddy's web root; the web check verifies `index.html`, not browser execution of every JavaScript module. The status pages remain available even when that build is absent.

## Maintenance and restarts

The operator command requires Python 3 on macOS or Linux. It atomically replaces marker files, serializes concurrent operator changes and requires no Caddy reload:

```sh
bin/site-state --state-dir /path/to/gateway/state maintenance
bin/site-state --state-dir /path/to/gateway/state restarting
bin/site-state --state-dir /path/to/gateway/state normal --wait-for https://your-site.example/__site/readiness --timeout 300
```

Maintenance persists until explicitly cleared, even if the backend is healthy. For a deployment restart, set `restarting` before stopping the backend. Start the new process, then use `normal --wait-for` to keep the restart page visible until Caddy reports core readiness and a present web entry point. A timeout leaves the override intact for the operator to investigate or roll back. Completion also refuses to clear a newer operator override created while it was waiting. The status page then automatically returns to the original route when the marker clears.

To clear an override immediately, use `normal` without `--wait-for`. This still cannot bypass Caddy's core readiness checks: a starting or failed backend continues to return `503`. Only Caddy interprets backend readiness; the operator command follows Caddy's code and state headers.

The existing authenticated `/maintenance/control` coordinator remains compatible through `RESONANCE_MAINTENANCE_UPSTREAM` (default `127.0.0.1:8090`). It must be configured separately if the administrator restart button is used. Run the existing standalone `docker/maintenance/maintenance.py` with `BACKEND_URL` pointing at the native backend, `STATE_DIR` matching Caddy’s marker directory, and `CADDY_READINESS_URL` pointing at Caddy’s `/__site/readiness`. This makes restart recovery follow Caddy’s decision instead of duplicating core-readiness rules. Keep the coordinator bound to its default loopback interface. Its `active.json` marker is interpreted as a planned restart when its state directory matches Caddy's. The operator command manages its own two markers and does not delete the coordinator's file. No public endpoint for writing marker files is added.

## Verification

```sh
CADDY_BIN=/path/to/caddy python3 -m unittest discover -s ops/caddy/tests -v
dotnet test tests --filter FullyQualifiedName~SiteReadinessTests
```

The integration tests run real Caddy against an isolated local backend. They cover state precedence, offline and recovery transitions, HTML and JSON responses, streaming, request-body/auth preservation, status-page caching and a backend failure occurring after a successful readiness probe. The dedicated site-health workflow runs these checks without triggering unrelated native app builds.
