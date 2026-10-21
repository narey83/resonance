# Resonance Pioneer Link helper (experimental)

Updated **21 October 2026**. One desktop helper handles **USB Export** and **Network
Link**, using `.resonance` action files and the same local dashboard. Behaviour,
platform support and compatibility can change. This is development software;
physical Pioneer player acceptance is still pending.

Install and launch the helper before visiting its [dashboard](http://127.0.0.1:55460/).
That address is served by the running helper, not the main Resonance web server.
Opening an action file selects the appropriate USB or Network Link view. Source and
installer tooling are in this directory; see Platforms and firewall below.

## USB Export

1. In Resonance, start an export from library selections, a set plan or Music →
   Export. Complete the track, player/playlist and review steps, then prepare the ZIP.
2. Choose **Open in USB helper** on the completed export and open the downloaded
   `.resonance` action file with the installed helper. The browser handoff is a file;
   it may need opening from Downloads if the browser does not launch the association.
3. In the helper, select a mounted external FAT32/exFAT destination, confirm the
   destination checkbox and choose **Write**.
4. Wait for verification to complete, then safely eject through the operating system.

The helper downloads only that export using a scoped 24-hour token. It verifies the
bundle, refuses existing-file/export overwrites and never formats drives. Cancellation
and failures roll back only files created by that transfer. New files are read back
and checked against their SHA-256 inventory before publishing. Keep action files
private while valid.

Folder selection chooses source tracks; it does not reproduce the source folder
hierarchy on the USB. The prepared bundle supplies the player database layout.
Manual ZIP transfer remains available: extract it, then place its `Contents` and
`PIONEER` folders together at the root of an empty, compatible test drive.

USB writes have been tested in isolated local folders. Physical drive and player
validation, including OPUS-QUAD and legacy models, remains required. The dual profile
contains classic and OneLibrary databases; that does not establish support for every
USB-enabled Pioneer product.

## Network Link

Run this helper on the same IPv4 LAN as the players. Sharing is OFF at startup.
Install the helper, then download a connection file from Resonance → Music →
Network Link. Open the downloaded .resonance action file with the installed helper, or load it
in the helper dashboard. It checks for library changes
every 15 seconds and automatically downloads and verifies prepared updates.
Tracks become available after indexing and full-track enhanced analysis complete.
Choose the players' adapter, then click Start Network Link. Select Resonance on
the player's LINK screen. Sharing stays OFF after every launch, even when the
saved server connection synchronizes automatically.

Download the connection file using a server address reachable from the helper
computer (a localhost URL only works on the same computer).

Connection files grant read-only whole-library download access for 30 days; keep
them private. Revoke helper connections in Resonance to stop future updates.
Already-downloaded music is a local copy and is not erased by revocation.
Server connections survive restarts; expired/revoked connections need a new file.
Use HTTPS outside a private network. Do not forward the player-facing NFS ports.

Updates preserve player track IDs and old audio paths during an active session.
Unchanged audio is reused. Removed/replaced tracks and old analysis generations
are retained until the helper exits so connected players can finish using them.
The source's full prepared bundle is downloaded on a revision change in this
initial implementation, rather than a per-track delta. Current preparation limits
are 10,000 indexed tracks and 50 GiB per downloaded bundle. A failed update keeps
the last working library. The helper can also import offline bundles manually;
those do not update automatically. Stop sharing before changing an offline copy.

The helper serves a private, hash-verified copy of the prepared audio, classic
Pioneer database and analysis. It does not reanalyse music or write source tags.
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
No installer changes firewall rules, starts sharing, or adds a login service.
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

Hardware validation is pending, including OPUS-QUAD. Support is not guaranteed
for every USB-enabled Pioneer product; a model must support the relevant network
LINK EXPORT protocol. The server uses the classic half of Resonance's dual export.
The OneLibrary half is preserved in the bundle but is not queried by this engine.
Waveforms/beat grids reflect available prepared analysis. Test browse, load, seek,
waveform, beat grid, track transitions, disconnect and reconnect on each model
before performance use. Never replace a known-working USB backup with this test.
Saved server connections reconnect and synchronize after a helper restart, but
sharing must be started explicitly each time. Manually imported offline bundles
must be loaded again after restart and do not receive automatic library updates.

## Build / test

Requires Go 1.27.2 or newer. Packaging also needs Python 3. From this directory:

```sh
go test ./...
(cd third_party/vynull && go test ./...)
python3 package.py  # GO may point to a private Go executable
python3 installers.py  # macOS pkgbuild and NSIS makensis required
go build -trimpath -o resonance-pioneer-link .
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o resonance-pioneer-link.exe .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o resonance-pioneer-link .
```

Use --no-open to avoid opening a browser. --allow-loopback is only for isolated
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

See the [DJ workspace and worker setup](../../docs/dj-workspace.md) for server-side
export configuration, and the [feature inventory](../../FEATURES.md) for product scope.
