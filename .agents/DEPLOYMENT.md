# Resonance deployment destinations and runbook

Last confirmed: 1 November 2026. Read this file before any deployment.

**Standing user rule: use only the dev laptop for builds, tests, application and
development servers, including temporary web QA and Metro, until the user explicitly
says Mac runtime use is OK.** Keep source editing and Git on the Mac; SSH/ADB
forwarding and artifact transfer are transport, not Mac application runtimes.

## User intent and defaults

When the user says **deploy**, deploy the requested changes to the existing
Resonance instance below. Do not ask them to repeat these established destinations.
When they say **everything**, include every changed application component, including
the web UI and mobile development app running from the dev laptop. Restart the backend only if its deployed
code or runtime actually needs updating. A source-control push alone is not a
deployment.

Use the user's latest explicit instructions if they change a destination or scope.
Ask only when a material destination or delivery choice is genuinely new, or access
fails and cannot be recovered through the established workflow. A deployment request
does not authorize publishing to app stores or an unrelated distribution channel.

## Default live server

| Item | Established value |
| --- | --- |
| Public application | <https://918837500.duckdns.org:8443> |
| SSH host | `dev-laptop.local` |
| SSH user | `narey` |
| LAN address | `192.168.0.80` |
| Runtime | Native Resonance executable and native Caddy |
| Direct backend | `http://127.0.0.1:55450` on that server |
| Readiness | `/health/ready`; expect HTTP 200, `ready: true`, `state: available` |
| Backend release pointer | `/home/narey/resonance-releases/current` |
| Backend deployment record | `current/deployment.json` under the release pointer |
| Persistent application state | `/home/narey/projects/resonance/.dev/app` |
| Persistent SQLite database | `.dev/app/data/resonance.db` under that checkout |
| Web releases | `/home/narey/resonance-web-releases/` |
| Caddy executable | `/home/narey/projects/resonance/.dev/caddy` |
| Caddy main configuration | `/home/narey/projects/resonance/.dev/Caddyfile` |
| Imported native site configuration | `/home/narey/resonance-gateway/releases/analysis-folder-first-1164c3c/site.native.caddy` |
| Caddy administration API | `http://127.0.0.1:2019` on that server |
| Server backups | `/home/narey/resonance-backups/` and existing gateway backup directories |

These describe the verified native deployment. Inspect the running process and
Caddy routes before changing them, because release directories and process IDs
change. The public `:8443` host routes API/backend requests to `127.0.0.1:55450`
and serves web assets from its configured web release. Port 3000 is not the live
deployment target.

The Mac source of truth is `/Users/narey/Projects/resonance`, repository
`narey83/resonance`, branch `main`. Do not reset or overwrite local or server work.
Prepare isolated source snapshots on the dev laptop and build/test there. Keep its
existing checkout and private state intact; never reset it to perform a deployment.

## Web deployment

1. Read `AGENTS.md` and `.agents/BUILD_AND_DEPLOY.md`. Verify the source commit,
   relevant tests, lint, security checks and production build on the dev laptop.
   Use a clean dependency install inside the isolated snapshot; matching source
   lockfiles do not prove an existing `node_modules` directory is current. The
   laptop has Node 22; its system npm 9 cannot install this frontend lockfile
   correctly. Use a current npm 11 without replacing global tools. Launch `npx npm@11`
   outside the project and pass `--prefix` for the frontend directory, or invoke
   its previously downloaded CLI with Node. Launching npx through npm 9 from
   inside this frontend can fail on `file:vendor/deepmerge` before npm 11 starts.
   Pre-commit validation must also run remotely against the exact staged files;
   do not skip the quality gate to avoid running it on the Mac.
2. Read the current server deployment record, running executable/PID, resolved
   `backend/wwwroot` link and the live Caddy routes. Check public and direct readiness.
3. Package `frontend/build` as an immutable web release with a SHA-256 file manifest.
   Upload to a new release directory and verify every uploaded file against it.
4. Preserve the previous web release and back up the configuration files and
   existing `wwwroot` link target. Retain older hashed static assets for open tabs.
5. Update only the current site's web-root references and the backend's `wwwroot`
   symlink, validate Caddy's configuration, and reload Caddy using its existing
   runtime environment. Do not print that environment or private configuration.
6. Verify the public HTML and current JS/CSS hashes, readiness, browser behavior
   and desktop/narrow layouts. Verify that a web-only deployment retained the
   backend PID. Restore the previous web configuration/link if activation fails.

Web-only changes do not require a backend restart, database migration, queue
rewrite or database replacement.

The frontend reload screen, render-readiness signal, continuous browser monitor
and Caddy browser-health gate are active as of 31 October 2026. The user installed
the exact-executable AppArmor permission; sandboxed Chromium was verified without
disabling browser protection. All eight real browser failure/recovery scenarios
passed. Mac Brave was used for the earlier desktop and narrow deployment checks.

The enabled user service is `resonance-frontend-health.service`, running from the
complete snapshot `/home/narey/resonance-builds/deploy-a68e234` with `/usr/bin/node`.
User lingering is enabled, so it starts after laptop reboot. Inspect with
`systemctl --user status resonance-frontend-health.service` and
`journalctl --user -u resonance-frontend-health.service`.
Its browser origin is `http://127.0.0.1:8092`; its health endpoint is
`http://127.0.0.1:8091/health/ready`. Both listeners bind only to loopback.
Two consecutive failures close web access; two successes reopen it. API and hub
requests remain independent of browser health when the backend is healthy.
A stopped/stalled monitor also closes web access; keep it running during ordinary
web deployments. See `ops/caddy/README.md` for freshness and recovery behavior.

Use the current imported site configuration from the table above when updating
web roots or restarting the backend. Older private deployment helpers hardcode
the previous `088fd31` or `frontend-health-f24694b` site paths and must be adapted before reuse. The existing
`088fd31/site-state` command still manages the shared gateway state directory.
When changing Playwright/browser versions, verify the new executable's sandbox
permission and real browser checks before switching the service. Activation and
backup evidence is recorded in
`/home/narey/resonance-builds/deploy-a68e234/deployment/frontend-health-verification.json`.

## Backend deployment and state preservation

Native basic analysis is a required deployment capability. Every backend publish
includes `tools/native-analysis/`: use its hash-pinned provisioning command and
real BPM/key detector preflight before declaring a native release ready. Read
`tools/native-analysis/README.md`. Persist `analysis.essentia_python` through the
settings API; never assume Docker's `/opt/keyenv/bin/python` exists on this host.
The established persistent environment is
`/home/narey/resonance-analysis/keyenv`; run the preflight against the interpreter
configured in the running server. Preserve that environment across releases.
Waveform/LUFS or an import-only test must not substitute for this gate. A missing
or failing detector blocks readiness for deployment; do not silently ship partial
basic analysis. Settings can reload without restarting the backend.

Build on the dev laptop under the standing user restriction. Previous native Linux deployments use a self-contained
`linux-x64` publish; inspect the current runtime/framework version and existing
deployment records before choosing publish arguments. Keep all private settings,
database files, cookies, signing material and application state outside artifacts.
Use `/home/narey/.dotnet/dotnet` for the installed .NET 10 SDK (verify its version);
the dev laptop's `/usr/bin/dotnet` currently selects SDK 9 and cannot build net10.0.

For a backend restart, follow `docs/upload-peer-cooldown.md`: take a verified,
consistent SQLite backup including committed WAL data, record queued upload IDs
before shutdown, reconcile their final state, and verify those IDs and metadata
again after recovery. Preserve genuine completions and explicit cancellations.
Keep a verified off-server backup. Abort if backup or reconciliation fails.

Do not roll back to a binary that clears unfinished uploads. The queue-preserving
connection-failure correction was deployed as backend commit `53053c7`; inspect
the current build rather than assuming an older release is a safe rollback.

Keep the additional offline SDK callback correction from `f24694b` in rollback
builds too. On 31 October, deployment verification caught two original queued
uploads marked failed when the SDK emitted a terminal callback before reporting
that the peer was offline, with no data flow. The correction parks those uploads
under their original IDs. Those two records were recovered while the backend was
stopped, with a scoped audit and fresh verified backups. Do not replay unrelated
terminal history. Builds such as `2238c51` predate this additional correction.
The verified deployment report is
`/home/narey/resonance-builds/deploy-a68e234/deployment/DEPLOYMENT.md`.

The server's SSD reported real media/read errors on 30 October 2026 and the
database was repaired earlier that day. Preserve recovered state and backups.
Never rerun historical database-repair or migration activation scripts as a
generic deployment command.

## Browser performance and storage link — 31 October 2026

The active backend is `8d2ccbf` (`media-path-8d2ccbf`) and web release is
`8f377fe` (`analysis-layout-8f377fe`). Transfer screens use paginated queues;
the global header and Overview share compact status samples. Do not restore
full transfer-list polling on every page. See `docs/upload-queue-paging.md`.

Rollback builds must also retain the lifecycle corrections `5a5084c` and
`2373e7b`: network playlist/watcher setup must not block HTTP startup, shutdown
must not launch a final library rescan, and loading the saved metadata-attempt
cache must not probe every music file on SMB. The media correction `8d2ccbf`
reuses a freshly authorized canonical path within each request; preserve signed
URL validation, root boundaries, symlink checks and range streaming.

The final restart stopped gracefully and verified all 44,902 pending upload IDs,
with consistent SQLite/WAL backups and matching complete off-server hashes.
Evidence: `/home/narey/resonance-builds/uploads-performance-20261031/verification/media-activation.log`.
Backups: `/home/narey/resonance-backups/uploads-paged-20261031-211447/media-path-8d2ccbf`.
Never replay the recovery operations from older private deployment helpers.

Ethernet diagnosis on 31 October found `enp0s31f6` negotiated at **10 Mb/s full
duplex**, despite laptop support for 1 Gb/s. The link partner advertised only
10baseT. Treat this as a dated measurement and recheck after the cable/port is
fixed; do not force gigabit or change network configuration based on this note.
The existing upload limit was approximately 15 Mb/s (1831 KiB/s); a temporary
6 Mb/s cap was proposed but **not approved or applied**. User expects 1 Gb/s.
The user authorized read-only storage-host diagnosis for this investigation;
this does not grant standing permission to administer the old server.

The user subsequently moved the laptop: Ethernet was rechecked at **1000 Mb/s,
full duplex**, with gigabit advertised by both ends. No upload cap was applied.
Fresh server-browser playback then measured 0.20–0.22 seconds, but Mac Brave
still reproduced approximately twelve-second waits on different tracks. Do not
present a dev-laptop browser result as a measurement of the user's Mac.

The initial HTTP/2-only mitigation was deployed as `media-http2-e4ab872`.
Its rollback backup remains under `/home/narey/resonance-backups/media-http2-e4ab872`.
A subsequent controlled Mac capture reproduced QUIC error 164 with matching server
traces: the browser remembered a 1 MiB header limit while the new proxy advertised
16 KiB on an early-data connection. The old gateway was Caddy 2.11.4; installed
2.11.7 has the smaller default. The original twelve-second incident was not
captured, so this proves the reproduced compatibility failure, not every historical
delay. See `docs/http3-playback-investigation.md`.

The replacement gateway policy imports `ops/caddy/http-transport.caddy` globally:
HTTP/1.1 + HTTP/2 + HTTP/3, `0rtt off`, explicit `max_header_size 16KiB`. Remove
`Alt-Svc: clear` from the native site at the same deployment. Preserve TLS,
authorization, range streaming and existing routing. Caddy may reuse an existing
QUIC listener across reloads, retaining its original early-data setting: apply
this policy to a fresh UDP listener. The initial migration starts from HTTP/2-only;
future changes on an active HTTP/3 listener need a controlled gateway restart or
an HTTP/3-off phase before re-enabling. Never restart the backend for this alone.
Run both `media_transport_check.py` (HTTP/2 fallback) and
`http3_resumption_check.py` (HTTP/3-only settings-change regression), then check
actual Mac playback. Keep synthetic diagnostic listeners separate from production
and stop them before enabling the production UDP listener.

Activated gateway `media-quic-91c9eb3` on 31 October 2026 at 23:21 UTC. Its
`deployment.json` records early data disabled, a freshly created QUIC listener,
16 KiB headers and unchanged backend PID 359197 / release `8d2ccbf` and web
`fcf1e59`. Backup: `/home/narey/resonance-backups/media-quic-91c9eb3`.
All temporary diagnostic origins were removed from the active gateway and their
separate UDP Caddy process stopped. Actual Mac Brave confirmed HTTP/3, HTTP 206,
next-track playback in approximately 0.65 seconds, paused state after frontend
reload, manual play after reload and seeking. Timing is a wall-clock estimate
minus advancing audio time, not a precise browser playing-event timestamp.
Test audio was paused afterward. Private proof: `.dev/quic-forensics/` on the Mac.

## Analysis controls web release — 31 October 2026

Deployed web `analysis-ui-6f76a83` with native gateway imports from
`/home/narey/resonance-gateway/releases/analysis-ui-6f76a83/`. Basic/Enhanced cards
are the only mode selector; Scan Settings shows the selected mode with skip/reset
options. The existing HTTP/3 policy remains `0rtt off`, explicit 16 KiB headers
and HTTP/1.1 + HTTP/2 + HTTP/3. Backend PID 359197 / release `8d2ccbf` and Caddy
PID 3992646 were preserved; this was a web-only activation.

A clean npm 11 install in the isolated source snapshot, 12 focused tests, five
dependency-security tests, lint, formatting, production build and desktop/phone
browser checks passed. Mac Brave verified the live selector, absent dropdown and
correct Basic/Enhanced button changes without starting a real scan. Public HTML
and JS/CSS hashes matched the release, and 80 older static files were retained for
open tabs. The unchanged dependency lock still reports 79 moderate npm audit
findings; third-party source-map warnings also remain. No dependency upgrade was
part of this UI correction.

Snapshot: `/home/narey/resonance-builds/precommit-upload-paging-14b99031e8`.
Rollback backup: `/home/narey/resonance-backups/analysis-ui-6f76a83`.
The gateway's `deployment.json` records activation and the prior web release;
`target-config.json` in the backup is the reviewed active configuration. Private
Mac proof and deployment scripts are under `.dev/analysis-mode-cleanup/deployment/`.

## Analysis results layout — 1 November 2026

Deployed web and gateway `analysis-layout-8f377fe`. The results list grows with
its virtual content and shares the analysis page's scroll area; it has no separate
inner scrollbar. Folder names wrap in full. The virtualizer uses the page scroll
position and observes changes to the controls above the results, including
initial loading and opening/closing scan settings. Keep virtualization enabled:
expanding a large library must not create every track row in the browser at once.

A clean npm 11 install, lint/formatting, 14 focused tests, five dependency-security
tests, production build and desktop/phone browser checks passed. Synthetic checks
used 1,000 folders / 6,000 tracks, verified the last folder and track fit inside
the page viewport, and kept the number of rendered rows below 100. Results height
matched its content height, with zero inner scroll offset. Actual Mac Brave
verified page scrolling and an expanded live folder; the results also matched its
content height and retained a bounded set of track rows. No real scan was started.
Existing dependency audit/source-map warnings remain as recorded above.

Backend PID 359197 / release `8d2ccbf` and Caddy PID 3992646 stayed running.
The explicit HTTP/3 early-data/header-limit policy was preserved. Public HTML,
current JS/CSS and an older JS file matched their release hashes; 85 older static
files were retained. Readiness passed for the public site, backend and continuous
browser monitor.

Clean snapshot: `/home/narey/resonance-builds/analysis-layout-clean-8d1801afe1`.
Rollback backup: `/home/narey/resonance-backups/analysis-layout-8f377fe`.
Private Mac proof and scripts: `.dev/analysis-layout/deployment/`.

## Compact analysis overview — 1 November 2026

Deployed backend, web and gateway `analysis-overview-8b411e1` from source
`8b411e176533b68b670d6972fdcbc268da09e353`. Backend PID 404591 uses the original
application directory, arguments and private environment. Caddy PID 3992646 was
reloaded in place; HTTP/1, HTTP/2 and HTTP/3, disabled early data, explicit 16 KiB
headers, browser monitoring and existing routes were preserved. The published
executable retains the queue recovery and native media-path corrections.

Basic coverage, enhanced feature coverage and the shared preparation queue have
their own sections. One Basic/Enhanced selection controls scan settings. Eleven
enhanced cards count usable saved results; missing legacy coverage is shown as
unknown/minimums until indexed. Vocals and cue/loop analysis may have no detections;
stem analysis counts processing rather than retained audio. Full explanations
are under Analysis details. All 35 existing complete enhanced summaries were
backfilled with feature coverage without rerunning models. Automatic preparation
remains paused. Dashboard reads use compact, path/size-guarded SQLite summaries,
not audio or report files (35 rows; median 17 ms over five pre-deployment reads).

A clean npm 11 install, ESLint/Prettier, 16 frontend tests, five dependency-security
tests, production build, Release/StyleCop build (zero warnings/errors), and 130
backend regression tests passed on the dev laptop. Desktop/phone production-build
checks used 1,000 folders and 6,000 tracks: separate sections, fitting labels,
settings interactions, final folder/track reachability, one scroll area, bounded
rendered rows and no page errors. Results start 203 px earlier on desktop and
153 px earlier on phone; with settings open, 340 px and 240 px earlier. Actual
Mac Brave verified live counts, Basic/Enhanced scan labels, expandable details,
page scrolling and an expanded folder with zero inner scroll offset. No scan or
playback was started. Existing 79 moderate npm findings and source-map warnings
remain. The optional legacy MSBuild FFmpeg download script is missing; the actual
managed FFmpeg/ffprobe binaries and real native BPM/key detector passed preflight.

The backend stopped gracefully. All 41,379 captured pending upload IDs and request
metadata survived shutdown and startup, with no terminal changes at reconciliation.
Both SQLite databases received consistent backups including committed WAL data,
passed quick/foreign-key checks, and were fully copied and SHA-256 verified on
the Mac before activation. The restart-triggered share scan subsequently finished
and Mac Brave showed Connected to Soulseek with no scan indicator. A follow-up
reconciliation still verified all 41,379 original upload IDs and request metadata,
with zero shutdown failures or recovery scheduling warnings. Public/backend/browser
readiness and current HTML/JS/CSS hashes passed after activation.

Checked snapshot: `/home/narey/resonance-builds/precommit-upload-paging-80f4a33fff`.
Rollback/backups: `/home/narey/resonance-backups/analysis-overview-8b411e1`.
Mac full backups: `.dev/analysis-compact/backups/8b411e1/`.
Private checks, screenshot and deployment proof: `.dev/analysis-compact/`.

## Analysis visual tidy — 1 November 2026

Live web/gateway: `analysis-tidy-0c339e1`, source
`0c339e14defc4c44c27be5c1f071480f82840691`. Basic, Enhanced and Preparation queue
now use individually bordered panels with aligned desktop edges and responsive
metric grids. Large counts use thousands separators and labels use normal casing.
Scan settings align with the overview/results gutters; each switch sits beside
its label, exposes its checked state, and can be toggled by clicking its text.
The skip/reset mutual exclusion and single Basic/Enhanced selection are preserved.

The exact staged source passed clean npm 11 installation, ESLint/Prettier,
17 frontend regressions, five dependency-security tests and a production build
on the dev laptop. Production-build browser QA passed at widths 1440, 1100, 800
and 390: all labels/counts fit, panel boundaries and desktop alignment, adjacent
switches, clickable labels and mutual exclusion, settings open/close, last
folder/track fully reachable, bounded rendered rows and one page scroll area.
The fixture used 1,000 folders / 6,000 tracks and started no scans. Actual Mac Brave
confirmed panel alignment, label clicks, checked-state changes and restored default
options; the live results had zero inner scroll offset. No live scan was started.
The desktop scan-settings strip measured 89 px high versus 122 px previously.
Stacked phone panels use more height than the earlier unbordered summaries.
Existing 79 moderate dependency audit findings and source-map warnings remain;
no dependencies were changed.

This was web-only: backend PID 404591 / `analysis-overview-8b411e1` and Caddy
PID 3992646 stayed running. Private state and queues were not modified. Public
HTML/current JS/CSS and an older JS asset matched their hashes; 98 older static
files were retained. Public/backend/browser readiness passed. Existing HTTP/3,
early-data-off and explicit 16 KiB headers were preserved.

Checked snapshot: `/home/narey/resonance-builds/precommit-upload-paging-44fdc1e4a4`.
Web rollback/config backup: `/home/narey/resonance-backups/analysis-tidy-0c339e1`.
Private verification and Mac screenshot: `.dev/analysis-tidy/`.

## Analysis tab alignment — 1 November 2026

Live web/gateway: `analysis-flush-add95b8`, source
`add95b8282bc0623333bbcbbbd4e129fd8b66f45`. The Analysis panel now shares the tabs'
white surface and horizontal gutter. Its nested grey inset, top margin and outer
summary border were removed. Mode controls, coverage panels, scan settings and
folder results align with the Track Analysis / Waveform Inspector tabs.
Camelot/Musical display buttons and the All Keys filter were removed from this
page, along with the unused key-summary request and filter/focus state. Actual
key measurements and per-track editing remain available.

Exact staged source passed a clean npm 11 install, ESLint/Prettier, 18 frontend
tests, five dependency-security tests and production build on the dev laptop.
Browser checks at widths 1440, 1100, 800 and 390 verified the matching surfaces,
zero inset top margin/border, tab-aligned edges, absent key controls and no key
summary request. Existing panel/label/count, clickable-switch, virtualization,
last-folder/track reachability and single-scroll checks also passed. Actual Mac
Brave confirmed all five left edges equal, white analysis/tab surfaces, zero key
controls and zero inner results scroll offset. No scan was started. Existing
79 moderate audit findings and source-map warnings remain; dependencies unchanged.

This was web-only. Backend PID 404591 and Caddy PID 3992646 stayed running;
private state/queues were not modified. Public HTML, current JS/CSS and an older
JS asset matched release hashes. 103 older static files were retained, readiness
passed, and HTTP/3, early-data-off and 16 KiB headers were preserved.

Checked snapshot: `/home/narey/resonance-builds/precommit-upload-paging-59df872c11`.
Rollback/config backup: `/home/narey/resonance-backups/analysis-flush-add95b8`.
Private checks and Mac screenshot: `.dev/analysis-flush/`.

## Folder-first analysis browsing — 1 November 2026

Live backend/web/gateway: `analysis-folder-first-1164c3c`, source
`1164c3c91b61e758ee3885965dfc55279cd9c2ab`. Backend PID 476721 uses the original
application directory/private environment; Caddy PID 3992646 was retained.
The former page downloaded all 59,413 track records before its folder counts
settled. It now fetches complete directory totals first, and requests 200-track
windows only as expanded rows enter the viewport. Two requests run concurrently;
32 completed windows are cached, and obsolete/off-screen requests are cancelled.
See [the browser design](../docs/analysis-folder-browsing.md).

Filtered folder totals and track windows share the repository's readiness/search
rules. `recursive=false` requests a direct folder, while existing recursive callers
retain their default behavior. Explicit folder/all selection and folder scans
still resolve their full scope; bulk selection disables scan actions until ready.
Readiness-result changes clear obsolete selections. No schema/dependency changes.

Clean npm 11 installation, ESLint/Prettier, 33 frontend regressions, five dependency-
security tests, Release/StyleCop compilation (zero compiler/analyzer warnings/errors)
and 132 backend regressions passed on the dev laptop. The final frontend-only
selection refinement reused backend checks only after verifying every backend/test
source hash and dependency-install input was unchanged in the same clean snapshot.
Browser checks at 1440/1100/800/390 used 1,000 folders / 31,324 tracks with a
25,330-track folder: zero initial track requests, one 200-track request on opening
that folder, six or seven track requests to traverse/jump to the library end,
<100 rendered rows, complete last-folder/track visibility and one scroll area.
Existing white/tab alignment, mode controls and clickable-label checks passed.

Read-only production SQL returned 75 folders / 59,413 tracks in a median 37.2 ms
across five reads (SQL timing, not browser latency). Actual Mac Brave showed all
75 complete folder totals on reload. All 40 rows of the Marshall Jefferson folder
were traversed and matched SQLite titles/artists/order. The 25,330-track HATE folder
opened successfully, and Basic ready filtering returned 1,679 tracks / 46 folders;
All restored the full 59,413 / 75. No scan or playback was started.

Before activation, both SQLite databases received consistent backups including
committed WAL data, passed quick/foreign-key checks, and were fully copied and
SHA-256 verified on the Mac. All 41,586 captured pending upload IDs/request metadata
survived shutdown/startup and the follow-up recovery check, with zero shutdown
failures or recovery scheduling warnings. Soulseek was connected. Automatic
preparation remains paused. Public/backend/browser readiness and public HTML/
JS/CSS hashes passed. 108 older assets were retained. HTTP/1/2/3, disabled early
data and explicit 16 KiB headers were preserved. Native BPM/key and managed
FFmpeg/ffprobe preflight passed; the optional legacy download script is still
missing. Existing 79 moderate npm audit findings/source-map warnings remain.

Snapshot: `/home/narey/resonance-builds/precommit-upload-paging-dda9727715`.
Rollback/backups: `/home/narey/resonance-backups/analysis-folder-first-1164c3c`.
Mac full backups/proof: `.dev/analysis-folder-first/`.

## Native enhanced analysis

The enhanced worker is installed separately from basic BPM/key analysis on the dev
laptop. Preserve these persistent paths across backend releases:

- Worker source: `/home/narey/resonance-analysis/native-worker-source/tools/analysis-worker/`.
- Enhanced Python: `/home/narey/resonance-analysis/enhanced/bin/python` (Python 3.12).
- DBN decoder Python: `/home/narey/resonance-analysis/dbn/bin/python`.
- Private native configuration: `/home/narey/resonance-analysis/enhanced-config.json`.
- Verified models: `/home/narey/projects/resonance/.dev/app/data/analysis-models/`.
- Results: `/home/narey/projects/resonance/.dev/app/data/candidates/`.
- Installed dependency locks, audits, model verification and preflight reports:
  `/home/narey/resonance-analysis/`.

Startup requires `RESONANCE_CANDIDATE_PYTHON`, `RESONANCE_CANDIDATE_WORKER`,
`RESONANCE_CANDIDATE_CONFIG` and `RESONANCE_CANDIDATE_OUTPUT_ROOT` pointing to
those locations. The native full-feature timeout is 3600 seconds; the private worker
configuration allows 3500 seconds. Preserve the running process's environment in
subsequent deployments. Basic analysis keeps its separate Python 3.14 `keyenv`.

Leave worker/thread overrides unset for automatic CPU and memory allocation. The
8-processor, 31 GiB laptop selects four simultaneous jobs with two CPU threads each.
Use CPU-only tensor wheels. The installed environments must pass dependency checks;
retain the exact installed locks rather than assuming the old Docker recipe is
compatible with native Python. The initial native audit retains setuptools and
PyTorch advisories; inspect the saved audit reports when updating. Model weights
are explicitly installed and verified against `tools/analysis-worker/models.lock.json`;
inference runs offline and must not accept unverified model/code uploads.

For a bounded test, pause automatic preparation and wait for active tracks to finish
before enabling the worker. Submit an explicit `onlyPaths` list to `analysis/scan`
with `enhanced: true`, `skipAnalysed: true` and `resetAll: false`. Confirm the selected
count, every enhanced completion, no failed features, and current full-track results.
Keep the automatic queue paused until bulk enhanced processing is requested; enabling
the worker otherwise makes the whole library eligible. The independent results do
not overwrite native/manual analysis or source tags. See `docs/dj-workspace.md` for
the feature contracts and model limitations.

## Default mobile delivery

The established active test device is the user's **Pixel 9 Pro XL**, running the
installed Resonance Expo development client. Its current JavaScript comes from
Metro on `dev-laptop.local` at `http://127.0.0.1:8082`. The Pixel-facing URL
remains `http://127.0.0.1:8081` through `EXPO_PACKAGER_PROXY_URL`. The Pixel is
securely paired directly with the dev laptop for wireless ADB. On the laptop,
use `adb -s PIXEL_TARGET reverse tcp:8081 tcp:8082`; the Mac is not needed for
this connection. Pairing was verified on 31 October 2026.
Do not run a second Metro on the Mac. The earlier Mac Metro was stopped when the
user clarified this rule on 30 October 2026.

- Laptop Android tools: `/home/narey/Android/Sdk/platform-tools/adb`.
- Run `adb devices -l` on the laptop to find the current Pixel connection.
  The Pixel's hardware serial is `4B211FDAS002B9` (model `Pixel_9_Pro_XL`).
  Wireless endpoints and ports change; do not assume an old endpoint still works.
  If disconnected, run `adb mdns services`, select this Pixel's
  `_adb-tls-connect._tcp` endpoint, then `adb connect IP:PORT`. Verify the target
  with `adb -s PIXEL_TARGET shell getprop ro.serialno` before changing its state.
  Ignore other discovered devices. Keep the laptop and Pixel on the same LAN,
  with Wireless debugging enabled on the Pixel.
- The laptop has its own trusted pairing; do not copy private ADB keys between
  hosts. If Android forgets it, use Developer options > Wireless debugging >
  Pair device with pairing code, then `adb pair IP:PAIRING_PORT` on the laptop.
  Enter the code at the prompt; never save it in this runbook or command logs.
- Check `http://127.0.0.1:8082/status` on the dev laptop and the existing Metro
  process before starting another server. Its working directory must be the
  requested source snapshot's `mobile/`, with the matching dependency lockfile.
  The active snapshot verified on 31 October is
  `/home/narey/resonance-builds/branding-20261030/mobile`; its parent contains
  `mobile-metro.json` and `mobile-metro.log`. Verify the PID/cwd before reuse.
- Reapply `adb -s PIXEL_TARGET reverse tcp:8081 tcp:8082` after a disconnect or
  reboot, and verify it with `adb -s PIXEL_TARGET reverse --list`. Device port
  8081 must reach laptop loopback port 8082. The laptop's LAN port 8081 belongs
  to another service; do not replace that service.
- Mac transport remains a fallback if the direct laptop connection is unavailable.
  Mac Android tools are
  `/Users/narey/Projects/resonance/.dev/android/sdk/platform-tools/adb`.
  The corresponding Mac transport command is
  `ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:8081:127.0.0.1:8082 dev-laptop.local`.
  A listener on the Mac must be `ssh`, not `node`/Expo. Only when using that
  fallback, remove the existing device port 8081 reverse and run
  `adb -s PIXEL_TARGET reverse tcp:8081 tcp:8081` from the Mac. Do not leave both
  hosts competing for the same device port. The previous Mac SSH bridge was
  stopped after the direct laptop connection was verified.
- Refresh/open the installed development client using
  `exp+resonance-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`
  for package `com.resonance.mobile`.
- JavaScript/TypeScript-only changes use this existing client and Metro. Verify
  successful bundle loading and the changed screen on the device. Preserve its
  account, server settings, playlists and application data.
- The branding development client was installed in place on the Pixel on
  31 October 2026. Its saved sign-in and library remained available; Discover
  now uses the shared waveform-R and Outfit wordmark in its masthead.
- Native dependency, plugin or configuration changes require a compatible native
  rebuild/install. Read `mobile/AGENTS.md` and `mobile/EXPO_GUIDE.md` first. Do not
  uninstall the app or clear its data as a routine update.
- Build Android/iOS bundles as appropriate. Installing on a newly requested iOS
  device or publishing through a new channel requires an actual target and signing
  setup; do not claim delivery based solely on a successful bundle export.

If the Pixel is disconnected or locked, report that concrete verification limit.
Do not ask again which already-established mobile workflow to use. Mac/Xcode
native builds require an explicit exception to the dev-laptop-only rule.

## Historical targets and secrets

`192.168.0.254` / `resonance-dev` is the old server and remains off limits without
an explicit request naming it. Historical Docker/Compose deploy scripts and
`bin/ci-deploy`, `bin/deploy-check`, `bin/dev-remote` and `bin/dev-server` are not
the native deployment runbook. Private `.dev/config.json` can still select a stale
remote mode; never infer the deployment method from that selector.

Do not put passwords, tokens, cookies, private environment values or signed media
URLs in this document, command output, commits or deployment reports.

## Automatic Pixel reconnection

The dev laptop runs the enabled user service `resonance-pixel-reconnect.service`.
Its source is `tools/android/pixel-reconnect.py`; the unit template is
`tools/android/resonance-pixel-reconnect.service`. Installed copies live under
`~/.local/lib/resonance/` and `~/.config/systemd/user/` on the laptop.
Every ten seconds it discovers this Pixel's current TLS endpoint, reconnects
using the existing trusted pairing, verifies its hardware serial, and restores
`tcp:8081` on the phone to laptop `tcp:8082`. It never pairs devices, opens apps,
starts Metro, or modifies another device's forwarding. Laptop user lingering is
enabled, so the service starts after laptop reboot without an interactive login.

Inspect with `systemctl --user status resonance-pixel-reconnect.service` and
`journalctl --user -u resonance-pixel-reconnect.service`. Stop automatic forwarding
before using the Mac fallback with
`systemctl --user stop resonance-pixel-reconnect.service`; resume with `start`.
Update installed copies from these source files and run
`systemctl --user daemon-reload` followed by `restart` after changes.

Recovery requires the Pixel to rejoin the same reachable LAN with Wireless
debugging enabled. Android may require unlocking after reboot, approving a new
Wi-Fi network, or turning Wireless debugging back on; the laptop cannot bypass
those Android controls. Revoked pairing requires a new pairing code. Metro must
also be running separately for the app to load. Automatic recovery was tested by
removing forwarding and disconnecting the Pixel; a physical reboot/network
switch was not performed.
