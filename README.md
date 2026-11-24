<div align="center">
  <img src="frontend/public/favicon.svg" width="96" height="96" alt="Resonance logo">
  <h1>Resonance</h1>
  <p><strong>A self-hosted music streaming app with library management and DJ tools.</strong></p>
  <p>Stream your music, organise your collection, plan sets and rehearse transitions.</p>
  <p>
    <a href="#what-resonance-does">Features</a> ·
    <a href="#screenshots">Screenshots</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#license">License</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/status-in%20development-orange" alt="Status: in development">
    <img src="https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet&amp;logoColor=white" alt=".NET 10">
    <img src="https://img.shields.io/badge/React-web-149ECA?logo=react&amp;logoColor=white" alt="React web app">
    <img src="https://img.shields.io/badge/Expo-mobile-000020?logo=expo&amp;logoColor=white" alt="Expo mobile app">
    <img src="https://img.shields.io/badge/storage-SQLite%20%7C%20PostgreSQL-4169E1" alt="SQLite or PostgreSQL storage">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL v3"></a>
  </p>
</div>

---

> **Pre-beta status:** Resonance is still in development. This GitHub repository
> shares the project overview, app screenshots and licence. The source code and
> other project files are kept on private local infrastructure until beta testing
> is ready. There is no public download yet.

**Resonance is an actively developed, experimental music platform.**

Resonance is an ongoing project exploring a modern music listening experience, combining music management, playback, audio processing, visualisation and intelligent music analysis.

The project is currently in development. Features, architecture and interfaces are subject to change, and it is not yet intended for production use.

I'm sharing development progress here and welcome interest from other developers and music enthusiasts.

### Current status

- 🚧 Currently in development
- 🧪 Experimental features
- 🛠️ Architecture and functionality evolving

Resonance brings together music streaming, a persistent music catalogue, automatic preparation, metadata enrichment and set planning. Its Soulseek integration provides network search, shared-folder browsing, transfers and community features. The web workspace is designed for desktop screens; a separate Expo/React Native app provides mobile access. The application uses SQLite by default, with PostgreSQL also supported.

Documentation updated **21 October 2026**. This is a snapshot of the current source, not a fixed feature commitment. Features, defaults, interfaces and compatibility can change as development continues.

Resonance is a modified version of [slskd](https://github.com/slskd/slskd). It is not maintained by, endorsed by, or affiliated with the slskd project or its author(s).

## What Resonance does

### Find and transfer

- Search Soulseek with inline filters for bitrate, size, duration, folder contents, encoding, and excluded terms.
- Browse a user's complete share tree and download individual files or entire folders.
- Manage live uploads and downloads with priorities, queue strategies, retry policies, speed limits, quotas, and time-based QoS.
- Protect the service with IP lists, user groups, leecher detection, and browse/search rate limiting.

### Organise and prepare

- Browse a SQLite- or PostgreSQL-backed catalogue by artist, album, genre, year, folder, or recently added.
- Automatically queue newly indexed tracks for analysis, including files arriving through Soulseek, `yt-dlp` and folders added under configured library roots.
- Prepare BPM, key, waveforms and loudness. Optional independent workers add beats/downbeats, genre, energy, vocal regions and phrase labels.
- Use saved table layouts, DJ filters, analysis status, track inspection and selection actions; build smart crates that update with the library.
- Edit tags in bulk and enrich metadata through MusicBrainz, Discogs, Last.fm, and Deezer.
- Convert audio, detect duplicates, and ingest tracks or subscriptions through `yt-dlp`.

### Plan and rehearse sets

- Compare key, tempo, genre evidence, energy and phrase timing before a transition.
- Preview the end of one track against the start of the next, with synced playback and a crossfader.
- Save and reorder set plans, then rehearse their handovers at one fixed master tempo, defaulting to the first track.
- See explicit warnings for genre mismatches, missing analysis and unsupported tempo/timing combinations. Compatibility suggestions do not guarantee a good musical blend.

### Play and share

- Use the docked player with BPM/key/LUFS, level meters, queue controls and waveform seeking.
- Toggle beatgrids, vocal regions and coloured DJ or musical phrases; inspect waveform detail from Normal through 256×.
- Bypass all audio processing, or enable subtle adjustments and explicitly unlock advanced controls.
- Choose Daylight, AMOLED, Midnight, Ultraviolet or Ember themes. Interface scale makes the desktop workspace more compact, with 100% as normal size and an automatic sizing option.
- Cast to discovered DLNA renderers or expose the library as a DLNA/UPnP media server.
- Use the Expo/React Native companion app for search, transfers, playback, library browsing, chat, and administration.
- Create, edit, delete and publish mixtapes, with token-protected public playback and `.m3u` or `.zip` downloads.

### Prepare DJ hardware exports

- Start a USB export from the library or the Export wizard, including tracks selected through folders.
- Prepare classic and OneLibrary databases, playlists, waveforms and beatgrids using the optional export worker.
- Use one desktop helper for USB transfer and Network Link. Network Link serves the prepared whole library and checks for updates automatically.

These DJ hardware features are **experimental**. Physical player acceptance is still pending; network support depends on the player's LINK EXPORT capabilities. Installer signing and native Windows/Linux validation also remain outstanding.

### Take the library mobile

- Use the Android or iOS companion app to browse your server library, stream music and manage mixtapes.
- Open a full-screen player with artwork, waveform seeking, queue controls and available BPM, key, LUFS and genre information.
- Search Soulseek, manage server transfers, browse shares, use rooms/chat and access administration according to your role.
- Choose Light, Dark, AMOLED, Midnight or system appearance, and Automatic, Original or Data saver streaming quality.
- Android also implements a local audio library, Android Auto, an optional player overlay over other apps and copying local tracks to a chosen folder or USB storage. These have different platform requirements from iOS and from the desktop DJ hardware export.

The apps are in active development: features and design can change, with more features being added.

### Operate it your way

- Use JWT, API-key, or trusted reverse-proxy authentication with built-in and custom roles.
- Run a controller with remote transfer agents for distributed storage and downloads.
- Integrate FTP, webhooks, scripts, Pushbullet, Gluetun, UPnP, Prometheus, and Grafana Loki.
- Inspect transfer analytics, peer geography, queue health, events, logs, databases, and HTTP captures from the UI.
- Store logs in the database by default, or select Disk or Both. Migrate PostgreSQL data to a separate SQLite instance using the explicit migration tool.

## Screenshots

Captured **21 October 2026** from the isolated 15-track test library, with enhanced analysis and export workers configured. The gallery shows the current desktop design in Midnight and Daylight. Screens and features can change as development continues.

<div align="center">
  <a href="docs/screenshots/library.png"><img src="docs/screenshots/library.png" alt="Resonance Midnight library showing track analysis status, BPM, key and the docked player with coloured DJ phrases" width="1000"></a>
  <p><em>The music workspace: analysed tracks, a persistent player and phrase-coloured waveforms.</em></p>
</div>

<details>
<summary><strong>Explore the library, player and DJ tools</strong></summary>

<br>

| | |
| :---: | :---: |
| <a href="docs/screenshots/albums.png"><img src="docs/screenshots/albums.png" alt="Daylight album browser with artwork and collection navigation" width="460"></a> | <a href="docs/screenshots/library.png"><img src="docs/screenshots/library.png" alt="Music library with analysed waveforms and docked player" width="460"></a> |
| **Album browser** — artwork and collection browsing in Daylight | **Docked player** — playback, waveform controls and metering |
| <a href="docs/screenshots/set-planner.png"><img src="docs/screenshots/set-planner.png" alt="Set planner with a running order, fixed master tempo and transition guidance" width="460"></a> | <a href="docs/screenshots/set-rehearsal.png"><img src="docs/screenshots/set-rehearsal.png" alt="Full-set rehearsal with fixed master tempo, handover navigation and crossfader" width="460"></a> |
| **Set planner** — build the order and review each transition | **Full-set rehearsal** — audition consecutive handovers at one master tempo |
| <a href="docs/screenshots/mix-preview.png"><img src="docs/screenshots/mix-preview.png" alt="Mix compatibility comparing the ending of one track with the opening of another" width="460"></a> | <a href="docs/screenshots/preparation.png"><img src="docs/screenshots/preparation.png" alt="Automatic preparation showing analysis progress and completed tracks" width="460"></a> |
| **Mix compatibility** — compare tempo, key and suggested handover regions | **Preparation** — automatic analysis progress, status and retry controls |
| <a href="docs/screenshots/smart-crates.png"><img src="docs/screenshots/smart-crates.png" alt="Smart crates with saved rules and live collection counts" width="460"></a> | <a href="docs/screenshots/converter.png"><img src="docs/screenshots/converter.png" alt="Daylight audio converter with source selection and conversion settings" width="460"></a> |
| **Smart crates** — collections that follow saved library rules | **Audio converter** — source selection, format settings and conversion jobs |
| <a href="docs/screenshots/export.png"><img src="docs/screenshots/export.png" alt="DJ hardware USB export wizard with folder-aware track selection" width="460"></a> | <a href="docs/screenshots/network-link.png"><img src="docs/screenshots/network-link.png" alt="DJ hardware Network Link page with whole-library preparation and shared helper setup" width="460"></a> |
| **USB Export** — select folders and tracks, then prepare a player export | **Network Link** — prepare the whole library for the shared desktop helper |

</details>

Capture instructions and privacy checks are kept with the private source.

### Android and iOS

Native development builds captured **21 October 2026** against the same 15-track test library. Android uses a Pixel 9 emulator; iOS uses an iPhone 17 simulator. These show the current apps, whose features and design continue to grow and change.

| Android | iOS |
| :---: | :---: |
| <a href="docs/screenshots/mobile/android/albums.png"><img src="docs/screenshots/mobile/android/albums.png" alt="Android Resonance app with album artwork tiles and native navigation" width="240"></a> | <a href="docs/screenshots/mobile/ios/albums.png"><img src="docs/screenshots/mobile/ios/albums.png" alt="iOS Resonance app with album artwork tiles and native navigation" width="240"></a> |
| **Android library** | **iOS library** |
| <a href="docs/screenshots/mobile/android/player.png"><img src="docs/screenshots/mobile/android/player.png" alt="Android full-screen music player with artwork, waveform, BPM, key and LUFS" width="240"></a> | <a href="docs/screenshots/mobile/ios/player.png"><img src="docs/screenshots/mobile/ios/player.png" alt="iOS full-screen music player with artwork, waveform, BPM, key and LUFS" width="240"></a> |
| **Android player** | **iOS player** |

Simulator captures do not imply store availability or verification of vehicle, casting, push or USB hardware integrations.

## Architecture

Implementation files are kept in the private source repository until beta testing.

| Area | Technology | Responsibility |
| --- | --- | --- |
| `backend/` | ASP.NET Core, EF Core, SignalR | Soulseek networking, API, transfers, library, integrations, auth, and telemetry |
| `frontend/` | React, Semantic UI, Recharts | Desktop web workspace, library, playback, set planning, administration and analytics |
| `mobile/` | Expo, React Native | Native companion experience for Android and iOS |
| `desktop/bridge/` | Go, native launcher and installer tooling | Resonance Bridge desktop app, USB transfer and device integration |
| `tools/analysis-worker/` | Python, separately installed engines/models | Optional independent enhanced analysis |
| `tools/usb-export/` | Python | Experimental DJ hardware database and analysis writers |
| `tools/DatabaseMigration/` | .NET | Explicit PostgreSQL-to-SQLite migration and validation |
| `extension/` | WebExtensions | Optional browser bridge for synchronising YouTube cookies |
| `tests/` | xUnit | Backend unit and integration coverage |
| `docker/` | Docker Compose, Caddy | Portable live development stack and server deployment configuration |

Real-time browser and mobile updates travel over SignalR. SQLite or PostgreSQL stores application state, the library catalogue, transfer history, and analytics data; media remains on storage you control. Logging defaults to database storage, with Disk and Both modes available.

## Security and privacy

Resonance is self-hosted: your database, credentials, catalogue, and media remain on infrastructure you operate. Soulseek is a peer-to-peer network.

## Project lineage

Resonance is based on slskd and retains its AGPL obligations, attribution, and additional terms. The fork has its own name, visual identity, feature direction, and Soulseek client identifier. The complete terms are in the public [LICENSE](LICENSE).

Source-level change history and third-party attribution are kept with the private project files.

## License

Licensed under the **GNU Affero General Public License v3.0 with Additional Terms**. See [LICENSE](LICENSE) for the complete terms.
