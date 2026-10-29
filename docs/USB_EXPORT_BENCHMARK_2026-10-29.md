# USB export checks and measurements — 29 October 2026

These measurements used the native Resonance server, the Mac Bridge and a 128 GB SanDisk 3.2Gen1 drive formatted as FAT32. macOS reported a negotiated USB link of 5,000,000,000 bit/s. They describe this test session, not a guaranteed device specification.

## Actual 15-track OPUS-QUAD test export

- Export ID: `616c41ad06c041ccbc23ecd0c0accff3`.
- Playlist: `Resonance OPUS-QUAD Test`.
- Dual legacy/OneLibrary export, 15 stereo PCM16 / 44.1 kHz WAV files.
- All 63 manifest-listed files matched their sizes and SHA-256 values on USB readback: 853,343,024 bytes in 5.98 seconds. The small export manifest was checked separately against the prepared bundle.
- All 45 ANLZ files had valid PMAI headers/lengths. Legacy databases and encrypted OneLibrary database were present. OneLibrary integrity was `ok`; track identities and playlist order matched legacy readback.
- FAT32 verification passed before and after writing. No benchmark files or incomplete staging directories remained. The drive was safely ejected.
- No audio was decoded or analysed on the Mac during these checks. Actual deck browsing/loading/playback remains unverified.

## Transfer and USB baseline

| Measurement | Result | Method / scope |
| --- | ---: | --- |
| Server cached ZIP read + SHA-256 | 2.58 s | 895,258,180-byte prepared archive |
| Authenticated HTTPS server → Mac | 15.35 s / 55.6 MiB/s | Written to internal temporary storage; source hash matched; first byte 39 ms |
| USB sequential write | 18.87 s / 27.1 MiB/s | 512 MiB temporary file; includes 18.49 s in `fsync`, rather than reporting the misleading 0.38 s buffered copy time |
| USB read | 4.20 s / 121.9 MiB/s | Same 512 MiB, remounted with cache bypass and verified hash |
| Bridge complete USB write | 36.32 s | Actual 15-track export, including file checksums and readback |

The current drive's sustained write speed is the main measured limitation. Its 5 Gbit/s connection and faster reads rule out USB 2 fallback. This is an inference from the measurements; USB version alone does not specify flash write performance.

Retaining these source FLAC files would reduce audio bytes by 30.7% (587,990,150 source bytes versus 848,243,594 WAV bytes). That format change has **not** been implemented; it would need correct database type/format metadata and hardware acceptance. The current test drive intentionally uses WAV.

## Export selection optimisations

The source-selection page now retrieves only playlist/crate/folder choices. It resolves a chosen source into an ordered snapshot and requests metadata only for that selection. Ad hoc selection also uses a small indexed SQL projection instead of loading full tag JSON and waveform status through analysis enumeration.

An isolated SQLite fixture measured 59,400 indexed summaries in **205.7 ms**, and two selected summaries in **1.4 ms**. These are repository query times, not HTTP or full page-load timings.

Headless Chromium production React render measurements (median of three runs, synthetic folders of 20 tracks):

| Fixture | Initial React render | Track rows | Folder rows | DOM elements |
| --- | ---: | ---: | ---: | ---: |
| Previous picker, 5,000 tracks | 41.9 ms | 5,000 | 251 | 31,773 |
| Updated picker, 5,000 tracks | 9.0 ms | 0 | 100 | 618 |
| Updated picker, 59,400 tracks | 30.6 ms | 0 | 100 | 618 |

These times measure the synchronous React commit, not paint or end-to-end page load. Folder construction and search are memoized, child lookup uses maps, membership uses a shared set and large folders expand on demand. Selection still includes all descendants, including rows not currently rendered. The common Downloads wrapper is omitted.

## Validation

- 72 targeted frontend tests passed, including header navigation, the four source flows, snapshots, large-folder selection, naming, inspection and Set Planner compatibility.
- 66 targeted backend tests passed, including source ownership/order, crate rules, path boundaries, repository queries, inspection, workspace and analysis persistence.
- 13 Python database/export tests passed.
- Bridge prepared-analysis guard race tests passed. Bridge unit tests and `go vet` passed; seven USB tests previously passed against the actual prepared ZIP in isolated temporary destinations.
- Production web build, affected-file ESLint, C# whitespace checks, Python syntax checks and diff whitespace checks passed.
- Sixteen headless fixture workflow/layout checks passed across 320, 390, 768 and 1440 px, with zero page errors or document overflow. The live public route loaded successfully in headless Chromium and rendered sign-in without JavaScript errors. Signed-in checks used native Brave; the tab automation connector remained unavailable, so authenticated headless live QA was not performed.

Bridge 0.3.8 was built with the existing release key, signature/hash checked, published and activated on the Mac. Network Link was restored on its original adapter. Its request handler permits prepared metadata reads/imports and blocks fallback local audio analysis.
