# Resonance Bridge (experimental)

Updated **29 October 2026**. One desktop helper handles **USB Export** and **Network
Link**, using `.resonance` action files and the same local dashboard. Behaviour,
platform support and compatibility can change. This is development software;
physical DJ-player acceptance is still pending.

Install and launch the helper before visiting its [dashboard](http://127.0.0.1:55460/).
That address is served by the running helper, not the main Resonance web server.
Opening an action file selects the appropriate USB or Network Link view. Source and
installer tooling are in this directory; see Platforms and firewall below.

## USB Export

1. In Resonance, start an export from library selections, a set plan or Music →
   Export. Complete the track, player/playlist and review steps, then prepare the export.
2. Choose **Open in Resonance Bridge** on the completed export. The browser opens
   the local Bridge dashboard and hands it this export. A `.resonance` action file
   is available as a manual fallback in the export's transfer options.
3. In the helper, select a mounted external FAT32/exFAT destination, confirm the
   destination checkbox and choose **Write**.
4. Wait for verification to complete, then choose **Safely eject USB**. Wait for the safe-removal message before unplugging. This ejects the selected physical USB drive; it never forces removal when the operating system reports it is busy.

The app’s **Safely eject USB…** tray/menu shortcut and Resonance Export’s **Safely eject in Bridge** link open the same local drive picker. Choose the drive there; the main server never unmounts devices on its own host. Linux safe removal requires the desktop UDisks service and `udisksctl`. If the OS refuses removal, close files/apps using the drive and retry or use its normal system eject control.

The helper fetches that export's manifested files directly using a scoped 24-hour
token. It verifies each file before offering the USB write, refuses existing-file/export
overwrites and never formats drives. Cancellation
and failures roll back only files created by that transfer. New files are read back
and checked against their SHA-256 inventory before publishing. Keep action files
private while valid.

Folder selection chooses source tracks; it does not reproduce the source folder
hierarchy on the USB. The prepared bundle supplies the player database layout.
Manual ZIP transfer remains available on demand: extract it, then place its `Contents`
and `PIONEER` folders together at the root of an empty, compatible test drive.

USB writes have been tested in isolated local folders. Physical drive and player
validation, including OPUS-QUAD and legacy models, remains required. The dual profile
contains classic and OneLibrary databases; that does not establish support for every
compatible USB-enabled DJ product.

## Network Link

Run Bridge on the same IPv4 LAN as the players. Sharing is OFF at startup.
Download `resonance-bridge-pairing.resonance` from Resonance → Music → Network
Link, then open **Bridge Settings → Resonance connection** and choose the pairing
file once. Opening the file with the installed app also saves the pairing. This
pairs the Bridge workspace for Network Link, USB Export and software updates.
Older `.resonancelink` pairing files remain supported.

Open Network Link from the sidebar, choose the players' network adapter and start
sharing. Select Resonance on the player's LINK screen. Library checks run every
15 seconds and prepare verified batches containing only fully analysed tracks.
Sharing stays OFF after every launch, even when the saved pairing reconnects.

Use a Resonance address reachable from the Bridge computer (localhost only works
on that same computer). Pairing credentials grant scoped read-only access for
30 days. Keep the file private. Revoke Bridge pairings in Resonance to stop future
access. Expired or rejected pairings must be renewed in Settings. Track audio is
never downloaded into Bridge storage. Use HTTPS outside a private network; do not forward
player-facing NFS ports.

Updates preserve player track IDs during an active session. Metadata and analysis
arrive in small deterministic batches; audio is fetched only when a player reads
it and is never cached to disk. Current preparation limits are 10,000 indexed
tracks. A failed update keeps
the last working library. The helper can also import offline bundles manually;
those do not update automatically. Stop sharing before changing an offline copy.

The helper stores only a private, hash-verified device catalog and analysis.
Audio remains in Resonance and is streamed on demand through authenticated range
requests; Bridge does not persist track audio. It does not reanalyse music or
write source tags.
Only devices on the selected adapter's subnet can query music. Discovery receives
broadcasts on wildcard sockets with source/subnet checks; file serving binds to
the selected IPv4 address. Use a trusted private DJ network, preferably Ethernet.
Close rekordbox LINK EXPORT and other competing link servers before starting.
It is not an authenticated streaming service or an Internet-facing server.

## Platforms and firewall

macOS Apple silicon: use the .pkg installer; the app is installed in /Applications.
Windows x64: use the setup .exe; installation is per user, with Start menu entries
and a registered uninstaller. Debian/Ubuntu amd64: install the .deb through your
package manager; an application launcher is included (requires xdg-utils).
Other Linux distributions can use the portable executable or build from source.
Development installers are unsigned/not notarized. Normal OS verification applies.
No installer changes firewall rules or starts sharing. On first launch the helper
registers per-user sign-in startup; turn it off from **Start at sign-in** in its menu.
Startup runs quietly without opening a browser and keeps Network Link sharing off.
Uninstall through Windows Apps settings, the Linux package manager, or move the
Mac app to Trash. Private cached connection files may remain; revoke connections
in Resonance before uninstalling if the computer will change owners. Native macOS execution is tested;
Windows/Linux binaries are cross-compiled and need native validation.
The browser dashboard only listens on loopback at [127.0.0.1:55460](http://127.0.0.1:55460/).

Allow the executable on your private player network: UDP 50000–50002 discovery,
UDP 50111 RPC, UDP 38251 mount, UDP/TCP 2049 read-only NFS, TCP 12523 db discovery
and the dynamically assigned TCP query port. The selected adapter must reach
player broadcasts; guest Wi-Fi client isolation and VPNs can prevent discovery.
No firewall changes are made automatically. This helper implements LINK EXPORT,
not audio output synchronization or mixer control.

## Compatibility

Hardware validation is pending. Support is not guaranteed for every USB-enabled
DJ product; a model must support the relevant network
LINK EXPORT protocol. The server uses the classic half of Resonance's dual export.
The OneLibrary half is preserved in the bundle but is not queried by this engine.
Waveforms/beat grids reflect available prepared analysis. Test browse, load, seek,
waveform, beat grid, track transitions, disconnect and reconnect on each model
before performance use. Never replace a known-working USB backup with this test.
Saved server connections reconnect and synchronize after a helper restart, but
sharing must be started explicitly each time. Manually imported offline bundles
must be loaded again after restart and do not receive automatic library updates.

## Build / test

Requires Go 1.27.3 or newer. Packaging also needs Python 3. From this directory:

```sh
go test ./...
(cd third_party/vynull && go test ./...)
python3 package.py  # GO may point to a private Go executable
python3 installers.py  # macOS pkgbuild and NSIS makensis required
go build -trimpath -o resonance-bridge .
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o resonance-bridge.exe .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o resonance-bridge .
```

Use --no-open to avoid opening a browser. Use --headless for a server/test process
without tray controls or sign-in registration. --allow-loopback is only for isolated
protocol tests; it adds loopback to the network chooser. Tests never start sharing
unless RESONANCE_TEST_EXPORT_ROOT is provided. Set RESONANCE_TEST_BUNDLE_ZIP to a
prepared set to test checksum-verified extraction. Test fixtures are not bundled.

The included modified Vynull protocol implementation is GPL-3.0-or-later;
Resonance helper code is AGPL-3.0-only. Full corresponding source, dependencies'
module versions, upstream provenance and licenses accompany each binary archive.
See UPSTREAM.json, THIRD_PARTY_LICENSE.txt, LICENSE and third_party/vynull/LICENSE.

## Connection file handoff

Install the updated helper before opening .resonance action files. macOS has a native Cocoa
launcher that receives Finder document-open events and passes the connection
to the running engine. Windows registers a per-user file association; Debian
registers the MIME type and desktop handler. Plain .json remains accepted inside
the helper dashboard for older connection files, but double-clicking a .json
file may open the system editor (including Xcode). Use the new download instead.

The browser checks `/api/browser-presence` on its own loopback address before
creating a direct USB handoff. This read-only endpoint permits CORS only for the
paired Resonance origin; all other Bridge actions retain the local-only origin
rule. If Bridge is absent, unpaired or blocked by browser loopback permission,
the export stays saved in Resonance for later transfer.

See the [DJ workspace and worker setup](../../docs/dj-workspace.md) for server-side
export configuration, and the [feature inventory](../../FEATURES.md) for product scope.

## Menu bar, system tray and sign-in startup

The macOS app stays in the menu bar. Windows and Linux use a system-tray icon.
The menu opens the dashboard or USB export, shows software update status, checks
for updates, toggles **Start at sign-in**, and quits the helper. Closing the browser
leaves the helper running. Startup restores the saved Bridge pairing and never
automatically starts Network Link sharing. A prepared USB export waiting for writing
defers a software update. Use **Defer export** to keep the saved server export for
later and release Bridge's temporary copy, allowing the update to install.

Linux requires a desktop session with D-Bus and a StatusNotifier/AppIndicator host;
GNOME may require its AppIndicator extension. On a headless host the loopback
dashboard remains available. Startup registration uses a per-user LaunchAgent on
macOS, the current user's Run registry key on Windows, and an XDG autostart desktop
entry on Linux. No administrator privileges are needed at runtime. macOS needs the
installed app bundle for startup registration. **Quit** exits for this session;
disabling **Start at sign-in** prevents future launches. Uninstalling on Windows
removes the Run entry; on macOS/Linux disable startup before removing the app.

## Automatic software updates from an instance

A Bridge pairing supplies the update source and its existing scoped token.
Software updates are separate from music synchronization. The helper checks at
launch, after pairing, every six hours and on request. It downloads a newer engine
in the background and automatically restarts when idle. Active Network Link,
USB downloads/writes, a prepared export awaiting writing, and library synchronization
all defer installation. Sharing stays off after a software restart.

The instance serves signed release metadata at
`/api/v0/bridge/updates/{os}/{arch}` and its binary at the corresponding
`/binary?sha256=...` endpoint. Both require a current pairing. `os` is `darwin`,
`windows` or `linux`; `arch` is `arm64` or `amd64`. The default release directory is `bridge-releases` under the backend application
directory (`--app-dir`/`APP_DIR`, or the executable directory). Override it with an
absolute `RESONANCE_BRIDGE_RELEASE_ROOT` and mount that release directory
read-only into its backend. Publish binaries before discovery metadata. Existing
USB-only tokens do not authorize updates; pair Bridge in Settings first.

Releases use an Ed25519 signature over exact metadata bytes, plus SHA-256 and a
128 MiB executable limit. The verification key is embedded during packaging.
Private-LAN HTTP remains supported, but neither a network interceptor nor an
instance administrator can create executable updates without the release key.
Credentials and binaries never follow redirects. Versions are numeric
`major.minor.patch`; equal/older versions are ignored. The installed supervisor
rechecks signatures and binary hashes on launch, monitors the updated engine's
startup health, and rolls back a failed startup. A rejected release is not retried
until a different signed release appears. Cached connection files and music remain
separate from software versions. Per-user version storage avoids privileged writes
to `/Applications` or `/opt`. This protocol updates the engine (including Windows/
Linux tray controls); the small native macOS launcher is part of the installed app
and changes to that launcher still require an app installer upgrade.

Release preparation (keep the key outside all source trees and archives):

```sh
go run ./cmd/helper-release --generate-key --key /private/release-signing.key
export RESONANCE_HELPER_UPDATE_PUBLIC_KEY="$(cat /private/release-signing.key.pub)"
export RESONANCE_HELPER_SIGNING_KEY=/private/release-signing.key
python3 package.py
python3 installers.py
```

`dist/releases` contains platform manifests and immutable hash-named binaries.
Copy that directory's contents into the instance's configured release root. Put the
installer/archive files from `dist` there too to make the existing authenticated
helper download controls available without individual artifact environment settings.
To publish a separately built engine:

```sh
go run ./cmd/helper-release --key /private/release-signing.key \
  --binary /build/resonance-helper --version 0.3.1 --os linux --arch amd64 \
  --output /published/helper-releases
```

Every engine must embed the same public key and its actual version using Go build
flags `-X main.updatePublicKey=... -X main.helperVersion=...`. A development build
without a public key reports updates unavailable and does not download executable
code. Keep the private key backed up securely. Keep trusted public keys stable:
key rotation and macOS native-launcher updates require a new installer. Normal OS
code-signing/notarization requirements still apply independently of update signing.

For a Linux build server and a separate Mac packaging host, run
`RESONANCE_HELPER_SIGNING_KEY=/private/release-signing.key python3 build-engines.py`
on the build server. Transfer the helper source, `dist/prebuilt` and `dist/releases`
to the Mac (never the private key). Set `RESONANCE_HELPER_PREBUILT_DIR` to the copied
prebuilt directory and `RESONANCE_HELPER_UPDATE_PUBLIC_KEY` to the public key from
`build-info.json`, then run `package.py` and `installers.py` there. Packaging checks
that every copied engine matches the recorded version, key and SHA-256. This path
requires no Go compiler or private signing key on the Mac.

The product is **Resonance Bridge**. USB Export and Network Link are its first
features. The generic backend controller is `Core/API/Controllers/BridgeController`
and its canonical API prefix is `/api/v0/bridge`. The previous
`/api/v0/analysis/pioneer-link` routes remain compatibility aliases. Existing cache
locations, bundle identifiers, executable protocol IDs and installer registry IDs
are retained to preserve saved connections and upgrades.

## Support diagnostics and resumable collections

Bridge writes private JSON-lines diagnostics under its per-user cache `logs` directory.
Engine and supervisor each keep a current 2 MiB log and three rotated files (16 MiB
combined maximum). Events include UTC time, engine version, startup/shutdown,
connection state changes, sync failures, batch download/apply/acknowledgment,
software update state, and USB transfer milestones/failures. Network packet traffic
is not recorded. A record is bounded to 60 KiB.

Choose **Save diagnostic report** on either the Network Link or USB Export dashboard.
The ZIP contains a status summary and recent engine/supervisor events; it excludes
connection files, music and analysis data. Credentials, URL query strings and common
absolute local paths are redacted both when recording events and when exporting.
Review a report before sharing it. The same local Host/Origin and explicit-request
checks used by other Bridge actions protect this endpoint.

On Resonance, filter System logs by the `Bridge` source. Administrators can also
retrieve `/api/v0/bridge/diagnostics`, which reports worker availability, analysis
readiness and connection count without credentials or track paths. Useful support
information is Bridge version/OS, UTC failure time, the local report and the
corresponding server Bridge events. Never request a user's `.resonance` file.

Network Link protocol 3 advertises only saved, completed, full-track analysis whose
source content still matches. Beats/downbeats, BPM, key, waveform bands and the
required enhanced features must all be available. Basic indexing and partial or
failed analysis do not qualify. Export preparation rechecks eligibility and hashes
before invoking the worker. No background analysis of the entire indexed library
is started by connecting Bridge.

The server plans deterministic hash buckets, divided into at most 100 tracks per
metadata batch. The player protocol allows 65,535 track IDs. Staging has a 20 GiB
budget; downloaded batches are acknowledged
only after a durable local checkpoint, then released on the server. Downloads
hold a lease so cleanup cannot remove an in-flight archive. Expired staging is
reclaimed after two hours. Failed batches retry after five minutes.

The local collection is scoped to its Resonance server URL and persists across
Bridge restarts. Immutable batch files and stable source identities preserve the
working collection during updates. The prepared analysis cache keeps at most 512
resident results, loading others from disk. Sharing remains off after startup.
Old immutable metadata generations remain on disk to preserve player handles;
they contain no track audio. Disk-full failures preserve the last committed
collection and are included in the support report.

### Pairing after restart

The selected file is imported once; the browser file picker itself clears on a
reload. Bridge displays **Pairing saved** while a connection is present, including
when the server is temporarily unavailable. It reloads the saved connection at
startup and reports expired, unreadable or inaccessible settings visibly.

Pairings are saved atomically with owner-only permissions in durable app settings:
macOS `~/Library/Application Support/Resonance/Bridge/connection.json`, Windows
`%APPDATA%\Resonance\Bridge\connection.json`, and Linux
`$XDG_CONFIG_HOME/Resonance/Bridge/connection.json` (default `~/.config`). The old
cache copy is migrated automatically when durable settings are absent. Disconnect
removes both copies so a forgotten pairing cannot reappear after a restart.
An explicit `--cache` test instance uses its own `state` subdirectory instead of
modifying the real user's pairing. Do not include this file in a support report.


## Bridge workspace (0.3.2)

Pairing is managed in **Settings → Resonance connection**, independently of the
music features. Download `resonance-bridge-pairing.resonance` from Resonance and
select it once in Settings. Existing `.resonancelink` and `.resonance` pairing
files remain compatible. USB export action files cannot be used as pairings.

Once paired, the shared sidebar opens Network Link and USB Export. Before pairing,
feature pages lead to Settings. An expired or rejected pairing locks feature
operations until renewed. USB action files must belong to the paired instance;
individual prepared exports still use their own scoped download authorization.
Drive confirmation, destination validation and existing-export protection remain
required. Pairing cannot change during active sharing or USB transfer.

Settings also contains start-at-sign-in, update checks and diagnostic reports.
No startup preference changes just by opening the page. Network Link starts only
on request, with a selected network adapter and a nonempty analysed collection.

The workspace uses a shared, embedded HTML/CSS/JavaScript shell with no remote
assets or new runtime dependencies. UI flow tests use the existing frontend
`jsdom` development dependency: `NODE_PATH=frontend/node_modules node --test
desktop/bridge/web.test.cjs` from the repository root.

## Appearance

Bridge follows the paired instance's saved Resonance theme automatically. Changes
arrive within about 15 seconds independently of library preparation. The last
synced palette is kept for offline use and restarts, scoped to that instance.

In Settings → Make yourself at home, choose Follow Resonance, Use system, or a
local Daylight, AMOLED, Midnight, Ultraviolet or Ember override. Local choices
are stored in this browser and sync between its Bridge tabs. They never change
the server's preference. Reduced-motion preferences are respected.

Only an allowlisted theme name crosses the pairing API; no other preferences or
server-provided CSS are exposed. Run `python3 generate-themes.py --check` after
web theme changes and regenerate with `python3 generate-themes.py` if required.
