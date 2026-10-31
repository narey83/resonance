# Resonance deployment destinations and runbook

Last confirmed: 31 October 2026. Read this file before any deployment.

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
   relevant tests, lint, security checks and production build on the dev laptop.
   Use a clean dependency install inside the isolated snapshot; matching source
   lockfiles do not prove an existing `node_modules` directory is current. The
   laptop has Node 22; its system npm 9 cannot install this frontend lockfile
   correctly. Use a current npm 11 via `npx npm@11` without replacing global tools.
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

The server's SSD reported real media/read errors on 30 October 2026 and the
database was repaired earlier that day. Preserve recovered state and backups.
Never rerun historical database-repair or migration activation scripts as a
generic deployment command.

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
