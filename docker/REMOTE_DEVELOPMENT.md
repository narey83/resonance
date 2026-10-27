# Development on ubuntu-server from the Mac

The authoritative source checkout is `/mnt/data/projects/resonance` on `192.168.0.254`. `/home/narey/projects/resonance` points to the same checkout. Edit it using Visual Studio Code's **Remote SSH: Connect to Host → resonance-dev**, then open that folder. The Mac has Microsoft's Remote SSH extension and a dedicated SSH alias/key configured.

The source remains bind-mounted into the server's backend and frontend containers. C# edits trigger a clean watched restart; React edits reload the web UI. Rebuild images for toolchain changes and restart the web service after package-lock changes. The server's Caddy configuration and music mounts are retained. SQLite is the live database. The backend no longer connects to the PostgreSQL network.

## Commands

From the Mac checkout:

```sh
./bin/dev-remote connect       # Private localhost web/API forwards; leaves server services running
./bin/dev-remote status
./bin/dev-remote logs backend
./bin/dev-remote disconnect    # Close only the Mac's forwards
```

Expo Metro and native iOS/Android builds stay on the Mac. `./bin/dev start` starts a one-way mirror of the server's mobile source into the Mac checkout, so remote JS/TS edits reach the simulators. The mirror excludes `node_modules`, generated `ios`/`android` projects, Expo state, environment files, signing keys and Firebase credentials. Edit mobile source on the server once this workflow is active; the Mac source is a mirror. Stop it with `./bin/dev-remote stop-mobile-sync` before making intentional Mac-only source edits. After package-lock changes, run `npm ci` inside the Mac's mobile directory and restart Metro; native changes still require a Mac native rebuild.

The forwarded web UI is `http://localhost:3000`; the API is `http://127.0.0.1:55450`. Ports on the server bind only to loopback; SSH carries the connection. Existing reverse-proxy access remains available separately.

The Mac's `.dev/config.json` uses `serverRuntime: "remote"` after cutover, so `./bin/dev start/restart/status` delegates backend/web management to the server and manages Expo Metro locally. `./bin/dev stop` stops the server's backend/web as well as local Metro; use `dev-remote disconnect` when you only want to disconnect the Mac.

In VS Code's remote terminal:

```sh
./bin/dev-server status
./bin/dev-server restart backend
./bin/dev-server logs web
```

The live server uses `/mnt/data/containers/resonance/docker-compose.yml` (also used by Dockge), with matching development overrides in `mac-development.yml`. The base file explicitly selects the current database provider. It selects SQLite; the PostgreSQL database is retained separately for rollback. These files belong to this particular server deployment. `dev-server` manages backend/frontend only; it does not stop PostgreSQL, Caddy or unrelated containers.

## Data and rollback

The current live database is `backend/data/resonance.db`, with native share caches beside it. The latest conversion report and backup paths are recorded in `.dev/migration-state.json`. It was refreshed from the server's PostgreSQL database while the backend was paused and validated by row counts, canonical-content hashes, foreign keys and SQLite integrity checks. The earlier conversion snapshots are inactive historical artifacts and must not replace the current database. The Mac's SQLite database remains separate. Never run two application checkouts against the same live data.

Migration backup paths and the original checkout are recorded in `.dev/migration-state.json` on the server. PostgreSQL removal is on hold until the user reviews and approves it. Preserve the original checkout, configuration backups and PostgreSQL dumps. Shared PostgreSQL services also serve other apps and must remain intact. The preserved server checkout contains other changes absent from the Mac snapshot. The database-side transfer-query limit has been restored; review the remaining logging, push and audio differences before removing that checkout.

For SQLite backups, stop the backend or use SQLite's backup API; copying only a live main file can miss WAL transactions. Include external artwork and other application assets. Music remains on `/mnt/music` and is not part of a source-code deployment.

The Mac's prior Docker data and caches remain available as a rollback copy. The local Docker stack should stay stopped while the SSH forwards own ports 3000/55450.


### SQLite log compaction

Raw diagnostic logs default to 3 days, warnings to 14 days, and errors/fatal events to 30 days. Expired details are atomically replaced with hourly counters by severity and source, retained for 90 days. Both current and legacy application logs are compacted; transfer history and transfer rollups are separate. The worker processes 1,000 rows per transaction and at most 32 batches per minute, yielding between batches. Existing large archives therefore shrink gradually. Deleted SQLite pages are reused; physical file shrinking requires a separate backed-up maintenance window.

The administrator-only `GET /api/v0/logs/summaries?days=7` returns compacted hourly counters (1–90 days). It does not return expired message text or replace the raw log endpoint. Retention settings are `Retention.Logs`, `Retention.WarningLogs`, `Retention.ErrorLogs`, and `Retention.LogSummaries`; warnings/errors are never kept for less than the routine log period. PostgreSQL rollback data and migration backups are retained.

## Maintenance restarts

Administrators can open **Status & controls → Restart with maintenance** in the web UI. A confirmation explains the interruption. This arms Caddy maintenance routing before calling the existing backend restart endpoint; it does not restart Docker, Caddy, or the frontend on each use.

The Caddy-owned maintenance helper uses the existing administrator-only JWT check at `/api/v0/options/yaml/location`; it neither stores tokens nor mounts Docker's socket. The coordinator uses Caddy's existing `site/maintenance` directory and binds only to loopback inside Caddy. A persistent, atomically replaced `active.json` marker gates API/hub requests with HTTP 503, `Retry-After: 5`, `Cache-Control: no-store` and `X-Resonance-Maintenance: true`. Web assets and `/maintenance/status` remain available. Clients retain their sign-in and retry normally. Mobile local-only mode is independent.

After observing the outage, the coordinator requires three consecutive successful core/database readiness checks and at least ten seconds elapsed before removing the marker. A healthy server whose restart did not happen is released after sixty seconds. An unhealthy server is never released just because time elapsed. Shares may continue preparing after API recovery; failed database/core initialization keeps maintenance active.

Resonance runs three containers: `resonance-frontend`, `resonance-backend` and `resonance-caddy`. The Caddy image includes Python and supervises the maintenance helper alongside Caddy. Build its Dockerfile from the repository root (`docker build -f docker/caddy/Dockerfile .`). The old `maintenance.compose.yml` is an empty compatibility override. Caddy's existing writable `/srv` mount retains the marker across recreation.

If the helper exits, its supervisor restarts it with backoff. If Caddy itself exits, the container exits so Docker's restart policy applies. Container shutdown terminates both processes. If manual recovery is required, first verify backend core/database health directly, then remove only `site/maintenance/active.json`. No database restore or data deletion is involved.

The backend image includes the tested bgutil provider and its Node runtime, pinned by the `BGUTIL_IMAGE` build argument. It runs as the backend user, listens only on `127.0.0.1:4416` inside that container, and is never published by Docker or proxied by Caddy. yt-dlp's bundled plugin uses this loopback endpoint. The supervisor restarts a failed provider with backoff and lets the backend drain before stopping it. The image build checks the expected provider version, and the launcher passes an explicit loopback host. Update the pinned image digest and validate the matching plugin in development, then rebuild/recreate backend; no separate sidecar or Node installation is required on the host. The provider and plugin are updated together to stable 2.0.2. The plugin archive is checked against GitHub's published SHA-256; its provenance is recorded in `backend/tools/yt-dlp-plugins/SOURCE.txt`.

Verification: isolated backend tests cover administrator rejection/acceptance, cross-origin rejection, restart forwarding, persisted state, unstable health and automatic recovery. Actual Caddy routing is exercised in a disposable network-isolated container. The live status route and unauthenticated rejection are checked without restarting the active backend/share scan. Native mobile UI testing remains an environment follow-up; TypeScript and maintenance-contract tests cover the shared Android/iOS code.

## Share-index priority and stall recovery — 26 October 2026

Enrichment now waits automatically whenever the share cache is not ready, a scan is pending, or indexing is active. The gate runs before candidate enumeration, provider requests, recording results and writing tags. An in-flight provider response can finish; its match is retained in memory until indexing ends. The pass and its counters remain intact, Stop/disable cancels the wait, and the API exposes `paused`/`pauseReason`. The header and metadata page explain the waiting state.

The stalled server had 245 concurrent upload-list queries in the captured stacks, 388 threads and about 1,800 file descriptors. The old bounded response still used an expensive archive filter/sort. SQLite listings now use a composite expression index with equality predicates and bounded finished history; all unfinished transfers remain included. A separate sparse index covers startup's exact dangling-transfer predicate, including removed records and missing end times. Index definitions depend on the completed-state category: revise/rebuild their definitions if that category changes. Planner statistics were refreshed for the deployed indexes.

Transfer-list endpoints admit at most two concurrent listings and return a brief retry response when busy. Global web polling prevents overlapping requests and uses a ten-second transfer-request timeout. On the real 4,614,583-row archive, active/recent-finished queries measured 0.2608/0.2809 seconds, and startup recovery measured 0.0001–0.0002 seconds. Both query plans use the intended indexes without sorting history.

The host also experienced a kernel writeback stall (`rq_qos_wait`; Docker blocked in filesystem sync). A temporary thirty-second reset of `/sys/block/sdb/queue/wbt_lat_usec` released it; its original value, 75000, was restored and verified. SQLite durability settings were preserved. All three physical disks are rotational. Recurring host-wide writeback stalls require separate host/kernel/storage review; application backpressure is not a guarantee against host I/O faults.

A cold backup of both databases and their WAL/SHM files is retained at `/mnt/data/resonance-backups/sqlite-stall-20261026-161221`. Core tracks and full share-cache integrity checks returned `ok`; this was not a full integrity check of every table in the main database. PostgreSQL rollback data was untouched. Private diagnostics remain under `/tmp/resonance-diagnostics` on the server and must not be published.

Maintenance stayed active during recovery and cleared automatically after healthy startup. The web session remained signed in. Startup cards are explicitly hidden whenever reconnect/maintenance covers the page, and reconnect overlays sit above the normal header. The hidden startup card retains its drag position.

Validation: 308 backend tests passed, one existing PostgreSQL integration test skipped; 10 focused web tests and focused frontend lint passed. Query-plan, exact recovery semantics, enrichment cancellation/resumption and live paused-state checks passed. Unit tests used executable RAM-backed temporary files to avoid host disk contention; native simulator UI checks were not part of this backend/web recovery.

Live completion confirmed: the latest share scan has an end timestamp and suspect=0; filename index rebuilt; enrichment restarted afterwards; Soulseek connected and logged in.


Enrichment attempt history (`metadata-lookup-attempts.json` in the persistent backend data directory) uses music-root-relative keys through `MusicPath`. Loading also migrates the current root's absolute paths and the supported legacy music root, merging duplicate entries by latest attempt time. Ordinary scans continue to skip prior attempts; explicit full rescans remain available. Keep this history file with the server data when deploying. The 26 October fix passed 315 backend tests (one PostgreSQL integration skip); the live automatic pass dropped from 18,128 queued tracks to zero reprocessed tracks. Pre-deployment history backups are under `/mnt/data/resonance-backups/enrichment-path-20261026/`.


Frontend compatibility fixes (26 October 2026): CRACO now adapts CRA's deprecated before/after dev-server hooks into setupMiddlewares, preserving source-map/custom middleware before the default stack and redirect/service-worker middleware afterwards. Only the broken published @soundtouchjs/core debug maps are excluded; other source maps remain enabled.

The postinstall script scripts/apply-node-compat.cjs applies idempotent, version-specific fixes for http-proxy 1.18.1 (Object.assign replaces util._extend) and eslint-plugin-n 16.6.2 (missing-file sentinel avoids the deprecated fs.Stats constructor). Docker builds copy this script before npm ci; the development entrypoint also applies it to existing dependency volumes. Deprecation warnings remain enabled. CI uses Node 22 and npm run test:node-compat to exercise real HTTP/WebSocket proxying and ESM resolution with --throw-deprecation. Reassess these small patches when upgrading either dependency.

The live mac-development.yml override targets http://resonance-backend:5030 because that container name resolves on the live network; the generic backend alias was missing. Independent local Compose stacks retain their own backend service target. Live verification passed: clean webpack compile without deprecation warnings, initialized API response through frontend proxy, and HMR WebSocket connection. Six focused Jest tests and four Node compatibility tests passed. The duplicate upload fix also passed 319 backend tests with one existing PostgreSQL integration test skipped; active uploads completed after deployment. A separate upload task/disposal shutdown race remains in TODO.md.


Upload shutdown (26 October): UploadService stops admission, links active uploads to shutdown cancellation, and waits for reserved tasks, progress/state callbacks and cleanup before the Soulseek client or DI services are disposed. Queued-slot waits observe cancellation. Transfer completion network lookups and speed reports are tracked; delayed offline-peer purges cancel during shutdown. Interrupted rows remain available to existing startup recovery. Six new regression cases brought the backend suite to 325 passed with one existing PostgreSQL integration skip. A live shutdown while uploads were active reached Client stopped without the earlier ObjectDisposedException/upload-speed/cleanup failures.

The development dotnet-watch process did not forward Docker TERM or INT reliably (a direct Docker restart forced exit 137). docker/scripts/backend-watch.sh now forwards TERM to the running resonance application, waits for its cleanup, then terminates the idle watcher. Both the development Dockerfile and Compose configuration use it; the live mac-development.yml override applies it to the existing toolchain image without rebuilding. The live backend has this entrypoint and a 120-second stop grace period. Production images are unchanged. Two Linux regression checks exercise delayed application cleanup and stopping before an application starts; backend CI runs them.

Backups for the upload shutdown changes are under /mnt/data/resonance-backups/upload-shutdown-20261026; the live override's prior contents are retained beside it as mac-development.before-graceful-stop.yml. A separate cancellation of the final database log batch during shutdown remains tracked in TODO.md.


Final database log drain (26 October): the log writer starts before other hosted services and stops after them. Shutdown closes its input queue and cancels retention housekeeping, while queued and in-flight inserts retain their own five-second window even if the host stop token has already expired. Only a real drain deadline cancels the writer and reports potential loss. This remains bounded best-effort logging; failed batches are not retried indefinitely. Five added SQLite/host lifecycle regressions brought the suite to 330 passed with one existing PostgreSQL integration skip. Live verification found both Application is shutting down and Client stopped in SQLite after the controlled restart, zero log-flush failures in container output, and container exit code 0. Source backups are under /mnt/data/resonance-backups/log-flush-20261026.


StyleCop cleanup (26 October 2026): 656 diagnostics resolved; Release build has zero StyleCop warnings and CI rejects their return. Source backup: `/mnt/data/resonance-backups/stylecop-20261026/source-before/`. Analyzer configuration and packages were not changed. Style-only executable bodies and initializer values were reviewed; one independent field-initializer ordering adjustment was reviewed separately. Combined backend regressions: 334 passed, one PostgreSQL integration skip. Optional analysis tag writes now distinguish sharing conflicts from real I/O failures and preserve decoded results when a file remains busy. Compact header backups: `/mnt/data/resonance-backups/compact-headers-20261026/`.


TODO reliability deployment (27 October 2026): startup transfer recovery retries SQLite error codes 5/6 only (three retries, fresh EF context per attempt, cancellation between attempts). Disconnected Soulseek diagnostics now distinguish 503 unavailability and 504 timeout; the port diagnostic preserves caller cancellation and reports unknown status on external timeout. Playback leases are renewed through the authenticated `/api/v0/musiclibrary/playback/activity` endpoint; the web player reports every 20 seconds, and Android/iOS use playback-service progress events. Local/offline native playback is excluded. Automatic preparation remains bounded to one job per two minutes during continuous playback. The archived-log chart loads only when expanded and never substitutes summaries for raw message detail.

The server build uses 1.5 CPUs for the live backend container; running compilers and full regressions inside it competes with active transfers. This deployment used an ephemeral builder/test container with only source/build/cache mounts, no live database or music mounts for tests, and no network for the full regression run. SQLite test fixtures were corrected to use SQLite maintenance instead of fake PostgreSQL DNS lookups. Verification: 347 backend tests plus one separate disposable PostgreSQL provider test; 131 mobile tests and TypeScript. Source backup: `/mnt/data/resonance-backups/todo-fixes-20261026/`. Native app source must be rebuilt/installed to deliver its new heartbeat. Do not run SQLite VACUUM until historical compaction and backup prerequisites are satisfied.

Web validation completed in separate runs: 488 general tests and 30 beatgrid matrix tests, all passed (518 total). The earlier combined run overlapped a resource-heavy ARM64 Essentia build and timed out in the beatgrid matrix before exhausting heap; stopping the competing build and splitting the runs resolved the validation failure without changing test assertions. The optional ARM64 production build was cancelled and its runtime smoke check remains open.

### Administrator tool updates

Open **System → Tools & updates** (`/system/tools`). Installed versions load without an upstream check; **Check for updates** queries stable upstream releases. Administrators can update yt-dlp, Deno and FFmpeg/ffprobe individually or apply all available managed updates. Batch failures are reported per tool and do not prevent subsequent tools from updating. Existing automatic-update settings remain in effect. Both the new API and the older mutation routes require an administrator JWT.

The bgutil card reports the running provider and current upstream stable release. It explicitly requires a backend image rebuild: its provider, Node runtime and matching yt-dlp plugin form one tested bundle. This page does not grant Docker socket access or install npm dependencies at runtime. Current bundle provenance is recorded in `backend/tools/yt-dlp-plugins/SOURCE.txt`.

First-install verification — 27 October 2026: published output now includes the matching yt-dlp plugin and provenance file, rather than relying on the source checkout. A disposable published backend with an empty data directory and no network seeded the four real media binaries, executed Deno JavaScript, encoded an MP3 with FFmpeg, and measured it with ffprobe. A second startup without network or access to the image bundle reused byte-identical cached binaries. The test did not mount live data. Run `python3 docker/scripts/verify-first-install-tools.py --publish-directory /absolute/path/to/publish --image resonance-backend-dev:latest`; the image must include the bundled tools and supervised bgutil. Results are written to `.dev/first-install-tools-report.json`. Earlier real YouTube extraction with stable bgutil/plugin 2.0.2 also passed; this is distinct from a full media download test.

### Overview reporting improvements — 27 October 2026

The overview now has separate Uploads, Downloads, Sharing & community and Resources views, alongside Network and Users. Directional glance views request only their current/previous summaries; the browser aborts superseded requests and does not launch the rest of an obsolete queue. Results render individually. Expensive non-windowed coverage/heatmap reports run only when their corresponding view is visible; resource polling is mounted only in Resources.

`includeTimings=false` requests counter-only summaries without parsing timing averages for every historical row; existing API consumers retain full timing data by default, and caches distinguish the two projections. The SQLite projection uses `IX_Transfers_Overview` as a covering index, groups by integer state and avoids sorting full transfer rows. The date reporting index and the formerly colliding model index definitions are repaired. Transfers schema version 3 creates both indexes and analyzes relevant legacy indexes, whose sampled statistics previously encouraged direction-wide scans. The live database was upgraded additively; no transfer rows, backups, or durability settings were changed.

Successful headline counts and byte totals exclude failed outcomes. SQLite summary, histogram, leaderboard, top-file, heatmap and user-list byte aggregates subtract resume offsets and clamp negative deltas to zero. Failures remain available separately; peer retention retains its original semantics while probing only active peers' earlier history. The bounded maintenance reports preserve before/after values and query plans under `.dev/overview-*-performance.json`. Large first-time ranges remain heavier than short ranges; cached revisits use the existing report cache.

Report-cache keys now retain duration in seconds and the TTL tier, with only the end offset quantized. This prevents different custom windows from reusing the same cache entry. The repeated rolling-window cache behavior is regression-tested.

### Live Map loading — 27 October 2026

The map uses one bounded user-report request (5,000 most recent peers), avoiding repeated SQL aggregation for each 500-peer table page. Stored coordinates render before independent optional geo/event enrichment. Local lookups are deduplicated and chunked at the API’s 2,000-IP cap; live peers use local batches before a maximum of four concurrent fallback lookups. Range changes abort browser requests and stop queued work, but cannot forcibly interrupt SQL already executing in the synchronous backend endpoint. Active-transfer polling waits for each response before scheduling the next poll. The existing user-report cache and administrator permissions are unchanged. Nine focused regression tests cover load order, late location/event results, zero coordinates, cancellation, batch caps, fallback caching and API signal forwarding. Read-only comparison evidence is in `.dev/map-loading-performance.json`; no backend or database mutation was required.

### Transfer history — 27 October 2026

History refreshes share a single in-flight browser request, cancel obsolete filters/pages, skip hidden-tab background work and preserve existing rows on background errors. Later pages use a fixed timestamp window; React 16 timer updates batch search and page reset to avoid an extra old-page query. The endpoint still uses its existing limit-plus-one lower-bound pagination and lazy retry details, avoiding exact full-history COUNT/SUM work.

The SQLite canonical Succeeded filter adds the numeric completed/success state predicate, allowing the existing date-ordered partial success index to serve it. Partial/legacy state substring searches retain their existing path. The Failed filter explicitly selects the existing unsuccessful state category; it does not match a nonexistent "Failed" description. Administrator permissions and older API callers remain unchanged. No index build or database rewrite is required. Performance evidence is recorded in `.dev/history-*-performance.json` and `.dev/history-query-profile.json`; deep offsets and broad substring searches remain follow-up work. Friendly outcome labels hide the internal Completed lifecycle flag, which says an attempt ended rather than that it succeeded.

History validation: 11 isolated backend report/history tests and 17 frontend/history/API tests passed; focused frontend ESLint passed. These checks do not replace the full repository suite.

Incoming search response handling stops quietly during deliberate shutdown. The resolver checks shutdown both before queuing and after acquiring its semaphore, verifies the logged-in connection before endpoint lookup, and handles the narrow disconnect race there. Returning null prevents the same expected shutdown exception being warned twice by Application and Soulseek. Unexpected failures outside shutdown retain the existing warning/rethrow behavior. An isolated resolver regression covers unavailable dependencies during shutdown; it does not perform a live network search.

### Users reporting snapshots — 27 October 2026

Overview Users starts with seven days, with explicit wider ranges and All history available. User-specific deep links preserve full-history behavior. Cold all-time aggregation is still expensive and is disclosed in that view; it is no longer the default first visit.

SQLite user totals are cached as an immutable JSON snapshot built from the existing covering transfer index. Pagination/search/sort SQL reads the snapshot and joins network metadata, preserving SQL matching and ordering. The aggregate is shared across view variants, and a version in each page-cache key prevents cached pages surviving a refreshed snapshot. Snapshot caching occurs before page-query gating to avoid nested gate acquisition. Its freshness interval is two minutes with the existing stale-while-revalidate policy. Requests omitting end use a fixed-start live key; explicit window handling remains separate. The PostgreSQL query and authorization policy remain intact. This is an in-memory cache, with no schema migration or persisted rollup.

Users browser requests are single-flight, obsolete views abort, hidden views skip background refresh, debounced React 16 search/page changes batch into one request, and failed background refreshes retain existing rows. Focused verification passed 14 backend and 8 UI regressions plus frontend lint. The bounded profiling artifacts are `.dev/users-query-profile.json`, `.dev/users-snapshot-performance.json` and `.dev/users-snapshot-alltime-profile.json`.

Users live verification caught mixed JSON numeric storage classes (integer zero versus fractional speed), which SQLite exposed inconsistently to Dapper. Both snapshot speed columns now explicitly cast to REAL. A regression exercises zero, fractional upload and fractional download values in the same page. Updated focused validation: 15 backend and 8 UI tests passed; no schema change was required.

Final Users verification: real signed-in table loading, fractional-speed sorting, second-page navigation and country filtering passed with no UI alert. The existing 11 API-security regressions passed, anonymous Users API access returned 401, scoped git diff --check passed, and the watched backend build emitted no new compiler/StyleCop diagnostics. Reviewed changes against the saved pre-task baseline; no dependency, authorization or schema change was introduced.


### Resonance Bridge desktop application — 27 October 2026

The desktop application is now Resonance Bridge, with source in `desktop/bridge`.
The generic backend controller is `Core/API/Controllers/BridgeController`; its
canonical prefix is `/api/v0/bridge`, retaining the prior helper and Pioneer Link
routes for compatibility. USB Export and Network Link are Bridge features.
Installers for macOS ARM64, Windows x64 and Debian/Ubuntu amd64, portable archives
and corresponding source are published under `backend/bridge-releases`. The
existing authenticated web download controls now identify them as Resonance Bridge.

Bridge registers per-user sign-in startup on first launch (menu setting to disable),
starts quietly at sign-in, restores its saved instance connection and leaves Network
Link sharing off. Windows/Linux use a system tray and macOS uses a native menu-bar
launcher. Linux needs a StatusNotifier/AppIndicator desktop host. The small native
macOS launcher still requires an installer when that launcher itself changes.

Engine updates come from the paired instance, with the existing pairing token,
Ed25519-signed metadata, a bounded SHA-256-verified download and platform/version
checks. Downloads happen automatically; activation waits for no active Network Link,
USB export or library synchronization. The installed supervisor checks startup health,
falls back to the last healthy engine and suppresses a failed release until another
release is published. Software and cached music/connections stay separate. A Network
Link pairing is currently required for updates; USB-only transfer tokens do not
confer update access. The updater verifies using a public key embedded in each build.

The development release signing key is outside source and archives at
`/home/narey/.config/resonance/helper-release/signing.key` (mode 0600); back it up
securely. Do not copy the private key to the Mac, backend container or distribution.
`build-engines.py` produces signed releases on the server; native packaging accepts
checked prebuilt engines on the Mac. Go 1.27.3 is required after the security scan
identified the standard-library certificate issue fixed in that version.

Verification: Go race tests and vet passed; platform-specific vulnerability scans
found no reachable vulnerabilities (unused transitive advisories remain). The real
isolated process test passed signed activation, restart, health, failed-update rollback
and pairing preservation. Twenty-two focused backend/security tests and nine web
handoff/download tests passed. Focused ESLint, controller formatting, Swift type-check,
macOS native launch, installer archive inspection and published checksums passed.
NuGet vulnerability-feed retrieval was unavailable, so no successful NuGet audit is
claimed. Native menu UI inspection timed out; Windows/Linux native tray operation and
actual OS reboot/sign-in checks remain follow-ups. No live database or music was
mounted into backend tests. The watched backend was restarted to clear stale source
filenames after controller moves and its health and anonymous update rejection were
verified afterwards.


Bridge web downloads — 27 October 2026: **Apps & integrations** in the main navigation
opens `/apps` (also `/apps/bridge`). Its Resonance Bridge page uses the current theme,
OS-specific typography and controls, explicit architecture/package labels and links
to setup, USB Export and Network Link. Downloads use the existing authenticated
`/api/v0/bridge/download` endpoint; unpublished builds stay disabled. OS detection
only identifies the OS family, not architecture compatibility. Contextual USB and
Network Link controls link to the central page and use Bridge filenames. Twenty-one
focused UI tests, focused ESLint, scoped diff checks and the live webpack build passed.
The signed-in page and enabled controls were visually inspected. The live Mac request
reached the installer, but Brave blocked the unsigned development package as an
unverified download; no browser protection was bypassed. Production installer
signing/notarization remains outstanding.


Bridge setup/revocation correction — 27 October 2026: library-worker readiness no
longer disables Bridge pairing. The Network Link page now shows inline setup/revoke
success and error messages (including blob-encoded server errors) and explicitly
separates worker readiness from pairing/software updates. Music preparation remains
unavailable until the existing USB/export worker is configured; this correction does
not start library preparation. Pairings are stored in `data/bridge-pairings.json`,
with optional absolute `RESONANCE_BRIDGE_PAIRINGS_FILE` override. Existing legacy
pairings are imported only when no durable store exists; legacy files are retained.
Writes use a private, flushed temporary file and atomic replacement. A token is
published in memory only after its state is saved; failed revocation leaves existing
connections valid and returns 503. Connection capacity checks are serialized.

Verification: 36 backend pairing/security tests and 18 UI tests passed, covering
worker-independent pairing, reload, migration, stale-store protection, failed writes,
capacity/concurrency and write/feature permissions. Focused ESLint, controller
formatting, scoped diff checks and live frontend/backend checks passed; no new Bridge
analyzer warnings. NuGet vulnerability-feed retrieval remains unavailable. The live
page was visually checked with setup enabled and the worker warning visible. Live
connections were not created or revoked during UI verification.

### Bridge export worker and 0.3.1 (27 October 2026)

`python3 docker/scripts/build-bridge-worker.py` extends the integrated backend
image using an isolated context containing only the USB export sources. The image
runs the nine independent format tests and a pip-audit scan during its build.
The live backend now uses `resonance-backend-dev:bridge-worker`, with
`RESONANCE_USB_EXPORT_ROOT=/src/backend/data/bridge-exports`. Its compose file was
backed up under the deployment directory's private `backups/` folder. Only the
backend service was recreated. SQLite remains live; PostgreSQL was untouched.

Bridge 0.3.1 installers and signed engines are published in `backend/bridge-releases`;
the previous release's manifests/installers are retained in `previous/`. The Mac
was updated through the instance's existing signed updater and verified at 0.3.1
with its pairing restored. Pairing settings now live in the platform's durable
configuration directory and migrate automatically from the legacy cache. The
browser file picker clearing is independent of saved pairing state.

Verification: 49 backend/security/readiness tests; 19 web tests; Go suite, race
checks and vet; actual worker-generated import / loopback / live-catalog tests;
three independent OpenSSL Ed25519 signature checks; and a native Mac process
quit/relaunch pairing test. UI lint passed. The worker vulnerability audit found
no known vulnerabilities. Go found no reachable vulnerabilities (two unused
module advisories remain). The isolated NuGet feed was unavailable, and C# style
and existing analyzer warnings remain visible rather than suppressed.

Live readiness was 0 fully analysed, current export-ready tracks out of 59,389
indexed tracks. Connecting Bridge does not start analysis of unfinished tracks.
No music export was queued against the real library. Local obsolete immutable
collection generations currently require manual cache maintenance; automatic
local garbage collection and physical-player validation remain outstanding.

### Bridge workspace 0.3.2 (27 October 2026)

The local Bridge dashboard now has a shared sidebar and dedicated Settings page.
Pairing is managed only in Settings and unlocks Network Link and USB Export.
Unpaired, expired and server-rejected connections are guided to Settings, and USB
handoffs must match the paired instance. Active sharing and USB transfer prevent
pairing changes. Existing Host/Origin/action-header and USB destination protections
remain. Pairing credentials are never exposed in page status.

Downloads now use `resonance-bridge-pairing.resonance`; existing pairing files and
legacy API routes remain compatible. Native installer menus include Settings.
The signed engine update supplies the redesigned dashboard to existing installs.
The Mac was updated through its paired instance to 0.3.2, retaining pairing, and
all three pages were visually verified. OS startup preferences were not changed.

Verification: 39 backend pairing/security tests, 19 Resonance web tests, five
Bridge UI flow tests, Go race suite and vet, JavaScript lint, gofmt/Prettier, three
independent OpenSSL signature checks. Go reports no reachable vulnerabilities;
two unused module advisories and existing C#/NuGet audit limitations remain.
Installers and signed engines are published, with previous releases retained.
The temporary test container removed itself. No new permanent service was added.
The frontend scanning-indicator issue was explicitly deferred while finishing
Bridge and remains unchanged.
