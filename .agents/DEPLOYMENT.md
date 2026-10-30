# Resonance deployment destinations and runbook

Last confirmed: 30 October 2026. Read this file before any deployment.

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
| Imported native site configuration | `/home/narey/resonance-gateway/releases/088fd31/site.native.caddy` |
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
   relevant tests, lint, security checks and production build.
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

## Backend deployment and state preservation

Build on the dev laptop under the standing user restriction. Previous native Linux deployments use a self-contained
`linux-x64` publish; inspect the current runtime/framework version and existing
deployment records before choosing publish arguments. Keep all private settings,
database files, cookies, signing material and application state outside artifacts.

For a backend restart, follow `docs/upload-peer-cooldown.md`: take a verified,
consistent SQLite backup including committed WAL data, record queued upload IDs
before shutdown, reconcile their final state, and verify those IDs and metadata
again after recovery. Preserve genuine completions and explicit cancellations.
Keep a verified off-server backup. Abort if backup or reconciliation fails.

Do not roll back to a binary that clears unfinished uploads. The queue-preserving
connection-failure correction was deployed as backend commit `53053c7`; inspect
the current build rather than assuming an older release is a safe rollback.

The server's SSD reported real media/read errors on 30 October 2026 and the
database was repaired earlier that day. Preserve recovered state and backups.
Never rerun historical database-repair or migration activation scripts as a
generic deployment command.

## Default mobile delivery

The established active test device is the user's **Pixel 9 Pro XL**, running the
installed Resonance Expo development client. Its current JavaScript comes from
Metro on `dev-laptop.local` at `http://127.0.0.1:8082`. The Pixel-facing URL
remains `http://127.0.0.1:8081` through SSH transport and `EXPO_PACKAGER_PROXY_URL`. For the Pixel connected to
the Mac, forward Mac loopback port 8081 to dev-laptop loopback port 8082 over SSH,
then use `adb reverse tcp:8081 tcp:8081`.
Do not run a second Metro on the Mac. The earlier Mac Metro was stopped when the
user clarified this rule on 30 October 2026.

- Android tools: `/Users/narey/Projects/resonance/.dev/android/sdk/platform-tools/adb`.
- Run `adb devices -l` to find the current Pixel connection. Wireless device IDs
  change; do not assume an old serial is still connected.
- Check `http://127.0.0.1:8082/status` on the dev laptop and the existing Metro
  process before starting another server. Its working directory must be the
  requested source snapshot's `mobile/`, with the matching dependency lockfile.
  The snapshot established on 30 October is
  `/home/narey/resonance-builds/home-recent-9deffa7a/mobile`; its parent contains
  `mobile-metro.json` and `mobile-metro.log`. Verify the PID/cwd before reuse.
- The corresponding Mac transport command is
  `ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:8081:127.0.0.1:8082 dev-laptop.local`.
  A listener on the Mac must be `ssh`, not `node`/Expo. The laptop's LAN port 8081
  already belongs to another service; do not replace that service.
- Ensure the Pixel has `adb reverse tcp:8081 tcp:8081`.
- Refresh/open the installed development client using
  `exp+resonance-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`
  for package `com.resonance.mobile`.
- JavaScript/TypeScript-only changes use this existing client and Metro. Verify
  successful bundle loading and the changed screen on the device. Preserve its
  account, server settings, playlists and application data.
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
