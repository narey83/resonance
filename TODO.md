# Follow-up work

## Deferred at user request — 24 October 2026

- [ ] CarPlay: Apple entitlement approval, signing profiles and physical CarPlay lifecycle/playback checks. See [mobile/CARPLAY_ENTITLEMENT.md](mobile/CARPLAY_ENTITLEMENT.md).
- [ ] Android Auto: head-unit browsing, large-library paging, playback failures and reconnect checks. Leave implementation and testing aside for now.

## Current completion checks

- [x] Fix native macOS FFmpeg discovery/provisioning and exercise actual transcoding.
- [x] Require scoped signatures for private playlist artwork; preserve public artwork links.
- [x] Enable backend watch/restart and document explicit LAN access for physical-phone testing.
- [x] Avoid Linux/Docker polling when unsupported; make development update checks quiet.
- [x] Check web themes and reduced-motion logo behaviour.
- [x] Re-run backend, web and mobile checks and inspect the changes for regressions.
- [x] Verify the mobile app on available iOS and Android simulators, excluding automotive integrations.
- [x] Record physical foldable/dual-screen and real-device checks that need hardware.
- [x] Create a recoverable local checkpoint without committing unrelated work or local runtime data.

## Verification notes

- Native Homebrew FFmpeg/ffprobe are discovered on macOS, including standard Homebrew directories when a GUI launch has a minimal PATH. Linux binaries are no longer downloaded on macOS. Actual 12-second low (96 kbps) and medium (160 kbps) streams decoded correctly as MP3. Windows ZIP extraction has a regression test; a Windows runtime was not available.
- Private playlist artwork requires a domain-separated, playlist-scoped, expiring capability. Unsigned, expired and cross-playlist URLs return 401. Authenticated playlist fetches seed web/mobile image signatures without exposing the account JWT. Public-token artwork works until unpublishing. Capabilities remain valid until expiry, as with existing signed library media.
- Backend watch detected changes and applied actual C# edits. Dev servers remain loopback-only by default; LAN access is an explicit configuration option. No physical-phone LAN test was possible without a connected handset.
- Unsupported host/Docker statistics now return unavailable instead of repeatedly failing. Development release checks are skipped. Production release checks now explain an inaccessible/missing release; publishing a release or supplying a suitable private-repository token is still an external prerequisite.
- Daylight, AMOLED, Midnight, Ultraviolet and Ember were selected in an isolated browser session and computed brand/icon colours verified. DevTools reduced-motion emulation reported `true`, logo animation `none` and effectively zero transition time; emulation was then reset.
- Backend: 282 passed, one existing PostgreSQL test skipped. Web: 459 passed. Mobile: 121 passed; TypeScript and focused lint passed. Release and web production builds passed, with existing compiler/dependency warnings.
- iPhone simulator: QA login, current library, playback, landscape full player and adding a track to a playlist passed.

## Hardware / environment follow-up

- [ ] Physical Android foldable/dual-screen device: hinge occlusion, tabletop posture, interruptions and repeated fold/unfold while playing. Simulator geometry tests do not replace this.
- [ ] Physical Android/iOS handset on LAN: connectivity and reconnect after Wi-Fi changes using the documented explicit bind setting.
- [x] Run the PostgreSQL provider integration test against a disposable PostgreSQL 16 database: passed. The temporary container and credentials were removed; live SQLite and retained PostgreSQL data were untouched.
- [ ] Production update delivery: verify access to an actual published release before relying on self-update.

The security checks above address the identified findings; they are not a claim of a comprehensive penetration test.

- Android simulator: QA login, library browsing and playback passed. The full player reflowed on the folded cover screen and in the half-open rotated tabletop posture; the playlist picker remained usable within a pane. A new persistent AVD is under `.dev/android/avds/`; the old AVD referenced deleted `/tmp` data. Its hardware keyboard is enabled. The QA app wrapper is `.dev/Android QA.app` and resolves the SDK graphics/Qt libraries. Cold-boot Android System UI showed one recoverable startup ANR; app logcat checks reported no AndroidRuntime crash. This is not a claim that every emulator instability has been eliminated.
- A source checkpoint (working files, tracked/index patches, base commit and checksums) is stored under `.dev/checkpoints/`. It excludes ignored runtime data, credentials and build output. The Git index and history are unchanged.
- Deploy the updated server with the current web/mobile clients: older clients do not seed private-playlist artwork capabilities.
- [ ] Windows production runtime smoke checks for native artwork dependencies. Linux ARM64 native artwork tests now pass inside the Docker SDK image; the separate production image still needs its deployment smoke check.

- Follow-up: .NET in-process hot reload produced a runtime metadata error during development. The manager now uses `--no-hot-reload` for clean watched restarts. Reconnection retries retain backoff across short failed handshakes; the reconnect panel inherits the workspace palette.

- Reconnect follow-up verified: repeated brief hub failures retain exponential backoff, elapsed time no longer resets on each brief handshake, and the dark reconnect panel uses the workspace palette. A real stop/start outage and a watched clean restart both recovered automatically in the existing chat tab. Four retry regression tests and all 463 web tests passed.

## Container dependency provisioning

- [x] Bundle checksum-verified yt-dlp, Deno and FFmpeg/ffprobe for Linux amd64/arm64 in both backend images; first startup seeds the writable persistent volume.
- [x] Check for managed-tool updates at startup and periodically, automatically install verified replacements, retain working copies on failed downloads, and retry failed initial setup.
- [x] Backend suite: 290 passed, one PostgreSQL integration check skipped. Image bundling tests cover both architectures and checksum failure; real Linux ARM64 download hashes/ELF architecture verified.
- [x] Build and run the local Linux ARM64 Docker stack on Colima; verify offline first boot, persistent data, host-file reload and backend restart. All 291 backend tests and 478 web tests pass inside Linux (one PostgreSQL integration check remains skipped). Native artwork, Essentia key detection and bundled media tools run successfully.

- Docker development follow-up: fixed Linux VirtioFS disk accounting to use fundamental blocks, so free-space display and download guards match `df`. The real-filesystem regression test passes in Linux ARM64. Local Docker web/API use the existing 3000/55450 ports; Metro remains native on 8081.


## Log storage follow-up

- [x] Add atomic hourly rollups for expired current and legacy SQLite logs, short raw retention and bounded background batches. Regression tests cover exact counts, repeated runs, severity retention and legacy source names.
- [x] Add an on-demand hourly archived-log chart, with 7/30/90-day history, UTC buckets, severity stacks and clear separation from retained raw messages. Verified live with 4,969,057 archived entries across 601 hours.
- [ ] Reclaim physical SQLite file size in a backed-up maintenance window after the historical compaction backlog clears.

## Playback startup investigation — 26 October 2026

- [x] Stop the web Play button from also opening the inspector; avoid walking all page descendants when the player appears. Focused library tests: 19 passed.
- [x] Separate iOS forward buffer (5 seconds) from Android settings (30 seconds ahead, 1 second start threshold); shared setup tests pass for both platforms and TypeScript passes. No codec or quality changes.
- [x] Renew playback priority with authenticated web/native heartbeats every 20 seconds, including native background progress events. Local/offline native playback sends no heartbeat. Allow one automatic preparation job every two minutes during continuous playback; idle preparation resumes immediately. Native clients need a new app build before this change reaches installed devices.
- [ ] Repeat cold-start benchmarks for MP3, FLAC, Opus, AAC/M4A, WAV/AIFF and WMA across web, iOS and Android; distinguish unsupported decoder/container combinations from buffering. Current native UI automation is unavailable and Android SDK is absent on this Mac.
- Measurements during the scan: sampled media range responses about 0.02–0.3 seconds; browser starts sometimes 5–12 seconds. These samples do not establish the remaining cause or prove native performance improved.

## Maintenance control — 26 October 2026

- [x] Independent Caddy maintenance marker, admin-only restart control and stable-health automatic recovery.
- [x] Web maintenance screen independent of app initialization; shared iOS/Android maintenance banner and sign-in message; local-only music remains available.
- [x] Isolated restart/auth/recovery and actual Caddy routing tests; live status/unauthenticated rejection checks without restarting the active backend.
- [ ] Native handset/simulator UI smoke test for maintenance and recovery after the mobile environment is available.

## Share-index priority and stall recovery — 26 October 2026

- [x] Bake automatic enrichment suspension/resumption into the backend for unready, pending and active share indexing; expose the waiting reason in the UI.
- [x] Fix indexed transfer listings and startup recovery, cap concurrent list requests, prevent overlapping web polls and bound their request duration.
- [x] Hide the floating startup card behind reconnect/maintenance screens.
- [x] Preserve cold SQLite/WAL backups and verify core tracks/share-cache integrity; maintenance cleared automatically after recovery.
- [x] Complete backend regressions (308 passed, one PostgreSQL check skipped), ten focused web tests and live waiting-state/scan-progress checks.
- [ ] Review host kernel/storage scheduling if system-wide writeback stalls recur. The temporary throttle reset was reverted to the original 75000 value.

Live completion confirmed: the latest share scan has an end timestamp and suspect=0; filename index rebuilt; enrichment restarted afterwards; Soulseek connected and logged in.

### Error-log follow-up — 26 October 2026

- [x] Stop room-message notifications returning `dispatchEvent` booleans to SignalR; verify message delivery and unsubscribe behavior.
- [x] Invalidate pending log queries and context responses when the log viewer unmounts.
- [x] Return stable SOULSEEK_UNAVAILABLE HTTP 503 responses for disconnected user-status/room-list requests and handle disconnect races; room-list timeouts return HTTP 504.
- [x] Return PORT_CHECK_TIMEOUT / HTTP 504 for external diagnostic timeouts, preserve caller cancellation, and return sanitized HTTP 502 for network failures. Unknown port status is not reported as closed.
- Historical SQLite lock failures predate the share/transfer recovery; no new ERR entries observed since the 17:51 UTC restart during this review.


### Enrichment history across mount moves — 26 October 2026

- [x] Use `MusicPath.ToRelative` for enrichment history loading, lookup and recording; preserve the newest outcome when legacy absolute and relative entries refer to one file.
- [x] Resolve cleanup checks against the configured music root; retain relative history when the root cannot be resolved.
- [x] Verify 315 backend tests passed, one existing PostgreSQL integration test skipped. Regression coverage includes mount moves, legacy records, duplicate outcomes, unrelated paths and unavailable roots.
- [x] Deploy with automatic maintenance recovery. Existing audio retained all previous history; the first live pass completed with zero tracks reprocessed, replacing the previous 18,128-track queue.

- [x] Fix duplicate upload enqueue/cleanup errors and missing SoundTouch source-map warnings. Verified live on 26 October; backend: 319 passed, one existing PostgreSQL integration skip; frontend/tooling: 10 focused checks passed.

- [x] Drain/cancel upload work before disposing backend services. Stop admission, include scheduled tasks/progress callbacks/notifications in the drain, cancel queued-slot waits and delayed peer purges, and preserve interrupted records for startup recovery. Verified 325 backend tests passed (one existing PostgreSQL skip), two isolated container-stop checks passed, and live active-transfer shutdown completed without the previous upload disposal/reporting/cleanup errors.
- [x] Forward development-container stop signals to the app before stopping dotnet watch; apply a 120-second Compose grace period. The old watcher ignored direct Docker TERM/INT signals. Live container now uses the forwarding entrypoint; CI includes its regression checks.
- [x] Flush queued/in-flight database logs with an independent five-second shutdown window; stop retention first and stop the writer after other hosted services. Verified 330 backend tests passed (one existing PostgreSQL skip). Live controlled restart persisted both final Application shutdown messages in SQLite, emitted zero log-flush failures, and exited with code 0. Genuine flush deadlines still produce a warning.


### Warning cleanup and compact page headers — 26 October 2026

- [x] Clear 656 StyleCop diagnostics without disabling rules; add a CI build guard against new StyleCop warnings. Other compiler/analyzer warning categories remain separate.
- [x] Preserve successful analysis when optional audio-tag writes exhaust sharing-conflict retries. Busy files retain their existing tags; genuine I/O failures still propagate. Four regression tests cover real file sharing, file fingerprints, disabled tag writes and unrelated I/O errors. Full backend suite: 334 passed, one existing PostgreSQL integration skip.
- [x] Match shared community/search headers and room toolbars to music headers: 44px rows and 16px titles. Compact notification and music workspace headings; retain wizard content and page actions.

- [x] Live desktop audit: rooms, chat, browse, Soulseek/YouTube search, library, analysis, export, network link, tags, duplicates, converter, overview, downloads, uploads, history, live map, YouTube downloads and system. Shared headers render at 44px/16px; no horizontal page overflow observed. Frontend targeted ESLint passed.
- [x] Retry only SQLite BUSY/LOCKED recovery writes up to three times, using a fresh context on each attempt and respecting startup cancellation. Genuine database errors still fail. Covered with a real writer lock, bounded contention, cancellation and permanent-error regressions; live startup completed successfully.


### TODO reliability fixes — 27 October 2026

- Backend: 347 tests passed in an isolated, offline container; the one PostgreSQL provider test also passed separately against a disposable instance. No new StyleCop diagnostics. SQLite-backed logging test fixtures now select SQLite explicitly instead of waiting on a nonexistent PostgreSQL host; assertions were preserved.
- Mobile: 131 tests passed; TypeScript and focused lint passed. Physical-device checks and installation of the new heartbeat code remain separate from source validation.
- Web: all 518 tests passed across two clean runs (488 general tests plus 30 beatgrid matrix cases). A combined run during the expensive ARM build timed out and exhausted heap after a beatgrid fixture failed to unwind; the separated reruns passed after stopping that competing build. Log-summary loading/failure/cancellation regressions, source lint and the development build passed. The chart rendered live without horizontal overflow.
- Deployment: backed up source under `/mnt/data/resonance-backups/todo-fixes-20261026/`; compiled outside the live backend CPU limit; all startup services became ready, Soulseek logged in, maintenance cleared automatically, and anonymous heartbeat requests returned 401.
- Storage reclamation remains gated: the read-only check found a retained legacy log dated 19 June 2026, so the historical compaction backlog has not cleared. Approximately 6.07 GB of SQLite pages are reusable internally; no live VACUUM or database replacement was performed.
- The canonical ARM64 production-image build attempted an expensive Essentia source rebuild and was cancelled. The separate production-runtime smoke check remains open; SDK/native-artwork checks from earlier work are not a substitute. Windows, physical-handset/foldable, full cross-device codec benchmarks and published-release access checks remain open. CarPlay and Android Auto remain deferred.

## Container consolidation — 27 October 2026

- [x] Deploy and verify the three-container stack: frontend, backend with private bgutil, and Caddy with maintenance recovery. Only these three Resonance services are running; both sidecars and their obsolete images were removed. The signed-in web session recovered automatically, and real YouTube extraction passed with stable bgutil/plugin 2.0.2.
- Overview database indexes, planner statistics and directional report improvements are deployed. The original live SQLite database has not been replaced by compaction; physical file reclamation remains separate.

- Tools page validation: 27 focused API/installer tests, 3 UI tests, 4 maintenance tests and 2 supervisor tests passed. The existing saturated log-queue timeout test still fails under this host load; investigate separately when bug work resumes.

- [ ] Historical Docker cleanup awaits renewed approval: see `.dev/three-container/cleanup-review.json`. The narrower sidecar/current-task cleanup completed without volume deletion.

- [x] Explain each media tool in System → Tools & updates. Verify automatic installation with an empty data directory, real JavaScript/audio processing and offline cache reuse. Fix omitted yt-dlp plugin files in published builds.

## Overview reporting — 27 October 2026

- [x] Separate Uploads and Downloads, with correct direction-specific cards, charts, peers, retries and queue waits.
- [x] Put CPU/memory/storage in Resources; lifetime catalog reach, ratio and community statistics in Sharing & community.
- [x] Load only visible reports, publish results individually, cancel obsolete browser requests and stop queued requests on view/range changes.
- [x] Repair missing/colliding report indexes, add the covering overview index and refresh misleading SQLite planner statistics; schema version 3 preserves the upgrade.
- [x] Count only successful transfers in headline totals and ratios, show failed attempts separately, and use actual resumed bytes in SQLite report aggregates.
- [x] Replace full-history peer-retention grouping with active-peer history probes. Keep detailed timing averages available, but skip their date conversions for headline counters.
- Verification: 13 focused frontend tests, 13 backend/report/provider regressions; live browser checks for the directional and Resources views. Timings are in `.dev/overview-index-performance.json` and `.dev/overview-covering-performance.json`. The 7-day counter sample improved from over three seconds to 552 ms; the 1-year cold sample still exceeded a three-second profiling deadline and should not be described as instant.

- [x] Prevent custom report ranges from colliding across cache TTL tiers, while retaining rolling-window cache reuse. Two targeted cache regressions passed.

### Live Map loading — 27 October 2026

- [x] Fetch the most recent 5,000 peers with one report aggregation instead of up to ten repeated table-page aggregations. Expose the existing cap when more peers match. A fixed seven-day comparison returned identical 1,093 rows: 11,157 ms across three old queries versus 4,023 ms for one query under concurrent dev load. Evidence: `.dev/map-loading-performance.json`.
- [x] Reveal stored locations before optional geo/event details finish; run those details independently, deduplicate/chunk local lookups at the 2,000-IP server cap, accept zero latitude/longitude, batch live lookups and limit fallback concurrency to four. Cancel superseded browser requests and stop launching their remaining batches. Already executing synchronous SQL is not forcibly interrupted.
- [x] Pace active-transfer polling after responses; cache unsuccessful live-location lookups for the mounted map and clear departed live peers. Nine focused map/API/report tests and targeted ESLint passed. Larger cold historical queries remain more expensive; the existing backend report cache is retained.

### Transfer history loading and outcomes — 27 October 2026

- [x] Keep history refresh single-flight across completion-event bursts, the fallback timer and manual refresh. Abort obsolete filters, pages and attempt lookups; skip background loads while the document is hidden and retain visible rows on a background failure. Foreground loads clear stale rows instead of displaying a previous filter under the new heading.
- [x] Keep later pages on a fixed end/start window. Avoid an unchanged debounce resetting the page; batch actual search/page changes in React 16 so they launch one query rather than first requesting the previous page.
- [x] Reuse the existing successful-transfer partial index for canonical Succeeded queries. A fixed warmed seven-day comparison returned identical 51 rows: 77.64 ms before versus 4.05 ms after. The first bounded profile under load took 2,021.54 ms for the old success filter. Default first-page SQL was already fast (4.46 ms). Evidence: `.dev/history-query-profile.json` and `.dev/history-success-performance.json`. No live database rows, indexes or durability settings were changed.
- [x] Show actual outcomes instead of internal "Completed, Errored" flags: Succeeded, Failed, Cancelled, Timed out, Rejected, Aborted, or Outcome unknown. Apply the same labels to rows, attempt lists and details. Failed filtering covers every unsuccessful terminal outcome; legacy substring state queries remain supported.
- [ ] Follow up on cursor pagination for very deep history and all-time substring searches. The bounded read-only profile stopped an offset-5,000 query after three seconds. The current page-window fix prevents new transfers shifting ordinary pagination, but does not eliminate offset scan cost.

History validation: 11 isolated backend report/history tests and 17 frontend/history/API tests passed; focused frontend ESLint passed. These checks do not replace the full repository suite.

### Search response shutdown handling — 27 October 2026

- [x] Drop incoming search work when application shutdown begins, recheck after the resolver semaphore, and avoid endpoint lookups when the Soulseek connection is no longer connected/logged in. A disconnect racing the endpoint lookup returns no response. Exceptions during deliberate shutdown return no response instead of being logged by both Application and Soulseek; unexpected operational exceptions retain their warning/rethrow path.
- [x] Isolated regression: the real resolver returns null during shutdown without touching unavailable application dependencies. Test collection isolates/restores the process-wide shutdown flag. The reported 13:58:24 warnings coincided with the history deployment; normal login recovered at 14:01:38 UTC.

### Overview Users performance — 27 October 2026

- [x] Default to a labelled seven-day view; retain 24h, 30d, 1y and All history, and preserve full-history behavior for direct `?user=` links. All history warns that its initial calculation is heavier. The original all-time query and index-only all-time snapshot both exceeded bounded profiling limits (3 seconds and 20 seconds respectively).
- [x] Cache a versioned, index-only SQLite user aggregate independently of search, sorting and paging. View SQL operates over cached JSON aggregates plus the existing network-info join, retaining SQLite filtering/order semantics. Snapshot generation happens before taking a view-query gate slot, avoiding nested semaphore acquisition. Snapshots refresh after about two minutes; page-cache keys include the snapshot version so refreshed totals invalidate old views.
- [x] Use a stable, exact-start live-window cache key only when the API end time is omitted; explicit windows retain their existing range-key behavior. This stops the growing all-time duration from defeating cache reuse, without merging different requested starts. PostgreSQL retains its original query path and permissions are unchanged.
- [x] Keep browser refresh single-flight across completion events and polling, cancel superseded requests, batch React 16 search/page resets, skip hidden-document background work, clean up debounce timers and retain visible users on background failure.
- [x] Validation: 14 isolated backend report/history regressions and 8 focused Users UI regressions passed; focused frontend ESLint passed. Seven-day read-only profiling: 1,092 users, 1,316 ms snapshot build, 30 ms first page and 32 ms next page. Evidence: `.dev/users-query-profile.json`, `.dev/users-snapshot-performance.json`, `.dev/users-snapshot-alltime-profile.json`. These are query measurements under dev load, not guaranteed end-to-end timings. No database rows, indexes or durability settings were changed.

Users live verification caught mixed JSON numeric storage classes (integer zero versus fractional speed), which SQLite exposed inconsistently to Dapper. Both snapshot speed columns now explicitly cast to REAL. A regression exercises zero, fractional upload and fractional download values in the same page. Updated focused validation: 15 backend and 8 UI tests passed; no schema change was required.

Final Users verification: real signed-in table loading, fractional-speed sorting, second-page navigation and country filtering passed with no UI alert. The existing 11 API-security regressions passed, anonymous Users API access returned 401, scoped git diff --check passed, and the watched backend build emitted no new compiler/StyleCop diagnostics. Reviewed changes against the saved pre-task baseline; no dependency, authorization or schema change was introduced.

- [x] Align Users timescale/search controls in one padded, wrapping toolbar. Desktop plus 480px and 320px viewport checks passed; controls remain inside the card and wrap at 320px. Eight existing Users tests, focused JSX ESLint, CSS parsing/changed-rule formatting and scoped diff checks passed. Full Overview.css formatting still reports legacy issues, confirmed against the pre-change stylesheet; unrelated CSS was preserved.
