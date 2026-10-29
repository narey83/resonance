# Bridge safe eject — 0.3.9

The Bridge USB Export screen offers **Safely eject USB** independently of preparing or writing an export. Select a mounted compatible drive, press the button and wait for the success message before unplugging. The native app/tray shortcut **Safely eject USB…** opens this drive picker.

Resonance’s Export header links to `http://127.0.0.1:55460/usb#eject` with **Safely eject in Bridge**. This must be opened on the computer running Bridge. The server does not unmount drives on its own host, and the existing localhost origin/header/pairing restrictions remain intact.

## Local action contract

`POST /api/usb/eject` accepts `{"id":"<current opaque drive ID>"}` and returns `{"ejected":true,"label":"..."}` only after the OS accepts safe removal. IDs are discovered locally and bind mount path, device, volume UUID and filesystem. Requests never supply executable commands or a raw device path.

- Discovery rechecks the mounted identity; macOS then rechecks both selected volume and its external USB whole disk.
- Active downloads/writes, software updates and overlapping device operations are rejected. Write and eject use the same operation lock.
- Drives hosting Bridge’s cache, prepared bundle or active Network Link files cannot be ejected by Bridge.
- macOS uses `diskutil eject` on the verified whole disk. Windows requests PnP safe removal, preserving OS vetoes. Linux uses non-forced UDisks unmount/power-off and rejects system disks or other mounted sibling volumes.
- No force-unmount flags are used. OS failures remain visible and drive choices are refreshed. Linux requires UDisks/`udisksctl`.
- Eject does not require the write-confirmation checkbox. It can be used with an already populated USB and no newly prepared export.

## Verification on 29 October 2026

Bridge 0.3.9 was built and installed on the Mac. The actual shared web button successfully ejected the SanDisk FAT32 test drive. All 15 tracks were present and the three player-database SHA-256 values matched the export manifest before ejection. The test made no export-write requests, macOS removed the mount, and Bridge removed the drive from its list.

The live test exercised 1440 px and 390 px layouts without overflow or JavaScript errors. Twelve fixture checks additionally exercised completed, active-write and OS-refusal states at 320/390/768/1440 px. Four responsive main-header checks verified the loopback shortcut and absence of the removed Analyse button.

Go race tests cover identity changes, internal/system disks, active transfers, concurrent write/eject, trusted browser requests, active Network Link files, OS failures, cancellation and platform command construction. The full Bridge suite passed with the actual 15-track ZIP fixture, including isolated write/readback checks; `go vet` passed. Thirteen Bridge UI tests and fourteen affected frontend tests passed, and the production web build succeeded.

Mac native code signatures and published engine signatures/installer checksums were verified. Mac, Windows and Linux installer artifacts were built. Physical Windows and Linux ejection has not been tested. Native macOS menu compilation/installation was verified; the computer-use connector timed out while inspecting the accessory app, so the physical test used the live shared Bridge screen in headless Chromium.
