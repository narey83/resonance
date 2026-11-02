# Caddy site availability

Caddy owns web availability and serves an independent status page before React loads. It probes the backend's `/health/ready` endpoint before forwarding a request. The endpoint reports core and database readiness without exposing internal diagnostics. Background analysis, share scans and optional tools do not hold the site closed.

The React app no longer polls `/startup` or `/maintenance/status` or renders the startup panel. An already-open app follows Caddy's explicitly classified `503` responses by reloading its existing URL. A disconnected application hub also checks Caddy once per existing reconnect attempt. The independent status page checks Caddy every five seconds and reloads when Caddy reports readiness. Sign-in storage is retained. Transient hub or local network failures retry in the background without covering the workspace. Initial session setup retains its normal loading indicator; an unreachable Caddy cannot serve a status page.

## Status contract

`GET /__site/status` is the public site check. It includes `Cache-Control: no-store`, `X-Resonance-Gateway: caddy` and `X-Resonance-Site-State`.

| HTTP | State | Meaning |
| --- | --- | --- |
| 200 | available | Core services and databases are ready, and a fresh browser probe rendered the web app. |
| 200 | degraded | The site is usable; an optional background service failed. |
| 503 | maintenance | An operator deliberately closed the site. |
| 503 | restarting | An explicit restart marker exists, or the backend reports shutdown. |
| 503 | starting | The backend is responding but required initialization is unfinished. |
| 503 | unavailable | The backend cannot be reached or its readiness contract is invalid. |
| 503 | frontend-unavailable | The backend is ready, but the web app cannot render/respond, its files are missing, or browser monitoring is unavailable/stale. |

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
RESONANCE_FRONTEND_HEALTH_UPSTREAM=127.0.0.1:8091
```

The backend address defaults to `127.0.0.1:55450`. All three filesystem paths are required. Caddy needs read access to the build, status pages and marker directory. Only the deployment operator needs write access to the markers. This template assumes the application is mounted at the domain root.

Import `site.caddy` at the top level of the existing Caddyfile, then import `resonance_site` directly inside each application site block, replacing its old API/hub/static routing. `Caddyfile.example` demonstrates the placement with a local hostname. Keep the current deployment's HTTPS site address and certificate configuration when adopting it.

Import `http-transport.caddy` **inside the existing global options block**, as in
the example. It enables HTTP/1.1, HTTP/2 and HTTP/3, disables HTTP/3 early data
(`0rtt off`), and explicitly sets `max_header_size 16KiB`. Caddy advertises the
actual HTTP/3 listener automatically; do not add a fixed-port `Alt-Svc` override.

A controlled Mac Brave capture reproduced QUIC error 164 when a resumed
connection remembered a 1 MiB header limit and Caddy advertised 16 KiB. This
matches the default change between the old 2.11.4 gateway and installed 2.11.7.
Disabling early data passed the same settings change over HTTP/3. See
[the investigation](../../docs/http3-playback-investigation.md) for evidence and
its limits. The earlier HTTP/2-only policy was a temporary mitigation.

Deploy the global import and remove the old shared site's `Alt-Svc: clear`
together. A Caddy reload can reuse a QUIC listener created with early data enabled;
verify that the listener is freshly created with early data disabled. During the
HTTP/2-only to HTTP/3 migration there is no existing production UDP listener.
For future changes to this setting on an active HTTP/3 listener, use a controlled
gateway restart or first disable HTTP/3 and allow that listener to close before
re-enabling it. Do not restart the backend or change browser security settings.

Validate and reload using the existing Caddy binary and service environment:

```sh
caddy validate --config /path/to/Caddyfile --adapter caddyfile
caddy reload --config /path/to/Caddyfile --adapter caddyfile
```

Deploy the backend readiness endpoint, the complete frontend build with its render-health signal, and the browser monitor before activating this gateway configuration. Until their contracts are ready, Caddy deliberately fails closed for web traffic. Publish frontend builds as complete releases before switching Caddy's web root. The status pages remain available even when that build is absent. The browser monitor is required by this configuration; installing source changes alone does not start it or update a running Caddy.

## Browser readiness

Run `node ops/caddy/frontend-health.mjs` from a complete source snapshot with Node 22 or newer, npm 11 for the existing lockfile, `npm ci` dependencies in `frontend/`, and Playwright Chromium installed (`cd frontend && npx playwright install --with-deps chromium`). Playwright is already pinned by the existing frontend lockfile; this introduces no new package. Keep the monitor outside frontend build/release replacement and run it under the existing process supervisor, or adapt `frontend-health.service.example` as a user service. The service example restarts a stopped monitor, gives its work a lower scheduling priority, and bounds its memory. No application restart, state change, or deployment is performed by the monitor.

Chromium's sandbox stays enabled. On Ubuntu with restricted unprivileged user namespaces, an administrator must allow this specific browser executable to use its sandbox, or supply an appropriately installed supported browser. Follow [Chromium's documented per-executable AppArmor approach](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md), avoiding broad path patterns. Do not disable the host-wide restriction or use `--no-sandbox`. The monitor fails closed if the browser cannot start. CI configures a profile for its exact downloaded test browser on its disposable runner; no production host policy is changed by these sources or tests. Browser child processes receive only a minimal environment, without application credentials, and browser-control and health ports bind only to loopback.

Add the separate `http://127.0.0.1:8092` listener shown in `Caddyfile.example`. It uses the same backend and web-root variables as the public site. The `resonance_site_probe` snippet binds it to loopback and skips only the public maintenance overrides and browser-health gate; application authentication and backend readiness still apply. There is no public probe path or client header that bypasses these gates. This separation avoids recovery deadlocks: the monitor can test the repaired app while visitors still see a status page. Keep both the probe and monitor ports private.

The monitor visits that loopback origin with a fresh, credential-free Chromium context. It verifies successful navigation, loaded same-origin JavaScript/CSS with correct MIME types, the application's explicit post-initialization render signal, visible root content and a responsive browser event loop. It exercises the login username field without submitting a form. Failed asset loads, uncaught script errors, React render failures, stuck session initialization and frozen renderers fail the probe even if `/health/ready` still returns 200. Optional third-party requests are blocked in the probe; optional services do not decide core readiness. Real users get a local reload screen if a React render fails, without deleting their sign-in storage.

Only one probe runs at a time. Each has a 20-second deadline; checks repeat 15 seconds after completion. Two consecutive failures close web traffic and two consecutive successes reopen it. A single transient failure does not flap the site. Results older than 75 seconds fail closed, so a stalled or stopped probe cannot leave a permanent healthy signal. A hung renderer's owned browser is stopped and recreated. The loopback monitor's read-only `/health/ready` endpoint is queried by Caddy, not a new browser per HTTP request. Caddy gives this check a short timeout and classifies a missing or invalid monitor as `frontend-unavailable`.

The probe verifies anonymous login or first-time setup, not every authenticated page, account permission, business operation, or client/browser extension. A user's route-specific React crash has a local recovery screen; it does not let one browser close the site for everyone. Persistent failures on unprobed authenticated operations still require application diagnostics or separately authorized synthetic-account checks. Caddy cannot supply a status page if Caddy or the user's network itself is unreachable.

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
node --test ops/caddy/tests/frontend-health.test.mjs
# After npm ci and npm run build in frontend/, with Chromium installed:
CADDY_BIN=/path/to/caddy python3 ops/caddy/tests/browser_check.py
CADDY_BIN=/path/to/caddy python3 ops/caddy/tests/media_transport_check.py
CADDY_BIN=/path/to/caddy python3 ops/caddy/tests/http3_resumption_check.py
dotnet test tests --filter FullyQualifiedName~SiteReadinessTests
```

The integration tests run real Caddy against an isolated local backend. They cover state precedence, offline and recovery transitions, browser-monitor outages, private recovery probes, HTML and JSON responses, streaming, request-body/auth preservation, status-page caching and a backend failure occurring after a successful readiness probe. Browser checks use a disposable copy of the actual production build, inject failures without touching application state, and inspect desktop/mobile views. The dedicated site-health workflow runs these checks without triggering unrelated native app builds.

The media transport check uses disposable loopback TLS, real HTTP/2 and a sandboxed
Chromium browser. It checks eight distinct track requests, byte ranges, seeking,
rapidly cancelled loads and reuse of the browser after a forced gateway reload.
Its startup deadline detects multi-second stalls in the fixture; it is not a
guarantee about playback over an arbitrary storage or client network. Verify the
actual Mac/browser route as well as server-local checks when investigating latency.

The HTTP/3 regression check uses a disposable TLS origin with only an HTTP/3
listener, so TCP fallback cannot conceal a failure. With the same browser cache,
it changes the header budget from 1 MiB to 16 KiB across a gateway reload, then
checks playback, seeking, byte ranges, new connection IDs and the browser NetLog.
Only the generated loopback certificate's public-key fingerprint is trusted by
that isolated test browser. Production certificate validation is unchanged.

### Transient probe failures and diagnostics

The per-request backend and browser-monitor checks retry one transport failure
(connection refusal/reset or response-header timeout), with a 100 ms interval.
The existing per-attempt deadlines remain unchanged. These are rewritten,
credential-free GET probes; application operations are not retried. Explicit
starting, restarting, unhealthy or invalid readiness responses still close the
site immediately. A permanently unreachable service still fails closed after at
most two attempts. A one-off probe transport failure no longer forces a healthy
application into its full-page 503 recovery flow.

For bounded, credential-free access diagnostics, import `access-log.caddy` beside
`site.caddy`, then add `import resonance_access_log /absolute/path/access.jsonl`
to the public site block. The log keeps status, timing, readiness classification
and backend probe response status, with 10 MiB rotation and two retained files.
Only fixed public page/readiness paths are recorded; request headers, query
strings, response headers and user IDs are removed. Do not enable credential
logging or replace this filter with raw access logs. A transport failure has no
probe response status; use its classification and duration alongside runtime logs.
