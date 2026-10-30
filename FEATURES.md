# Features

Resonance combines a Soulseek client with a desktop music library, analysis and metadata tools, DJ preparation, set rehearsal and multi-user administration. The separate mobile app provides companion access.

Updated **21 October 2026**. This inventory describes the current source and can change at any time. It is not a fixed roadmap or a claim that every optional integration is configured in a fresh installation.

| Area | Current scope |
| --- | --- |
| Core application | Library, transfers, desktop player, workspace tools, SQLite/PostgreSQL and database logging |
| Configured integrations | Basic BPM/key detection needs Essentia; enhanced analysis needs independent workers and model assets; external metadata/services need their own configuration |
| Experimental features | Pioneer USB export and Network Link; physical player compatibility and distribution signing remain to be validated |

Setup and operating details are linked from the [README](README.md#documentation).

## Search

- Submit, list, view, cancel, delete, and **restart** Soulseek network searches.
- Inline query mini-DSL for filtering as you type: `minbr:`/`minbitrate:`, `minfs:`/`minfilesize:`, `minlen:`/`minlength:`, `minfif:`/`minfilesinfolder:`, `isvbr`, `iscbr`, and `-term` exclusions.
- Result browsing with per-result filters (extension, artist, title, folder, year), locked-file indication, and free-slot/queue-length/upload-speed display per responding user.
- Folder-aware download — pick a destination subfolder before enqueueing an entire result folder.
- Browse another user's full share folder tree, including single-subfolder fetches.
- Regex-based filtering/throttling of incoming search requests, with a concurrency/circuit-breaker/file-limit throttle on search response processing.
- Sliding-window rate limiting on folder-browse requests, with optional auto-sent warning PM and per-user unblock.
- Configurable auto-expiry (retention) of stored searches.

## Transfers (downloads/uploads)

- Full transfer lifecycle: enqueue, cancel/remove, clear-completed, per-user/per-transfer detail, live queue-position polling.
- Global and per-group upload/download slot and speed limits.
- User groups with individual upload priority, queue strategy (e.g. round-robin), slot count, speed limit, and file/megabyte/failure limits per day/week/queued — built-in `default`, `leechers`, `blacklisted` groups plus custom groups.
- Automatic leecher classification based on configurable shared file/directory thresholds.
- IP blacklist with CIDR, P2P, and DAT list format support.
- Retry logic with configurable attempts/backoff and an incomplete-file strategy (overwrite/keep); separate handling for peer-rejected transfers (e.g. "Too many megabytes").
- QoS scheduling — named time-of-day windows with their own speed limits.
- Automatic Soulseek PM to the remote user on transfer failure/rejection, with templated messages and per-user cooldown.
- Retention policies for succeeded/errored/cancelled/failed transfers and for complete/incomplete files on disk.
- REST file explorer to browse/delete files in the downloads and incomplete-downloads directories.
- On-the-fly streaming/transcoding and preview endpoints for playing files without a full download.
- Deep transfer analytics/reporting (see Telemetry).

## Shares

- Multiple shared directories with optional aliasing to disambiguate colliding folder names.
- Regex-based share exclusion filters.
- Multi-worker background share scanning, force/skip-scan startup flags, and periodic automatic re-scan on a configurable interval.
- Share browsing/inspection UI: share table, contents, exclusions, tags, file-type breakdown.
- Add/remove shares at runtime; tag listing, per-file tag edit, and bulk directory rename.

## Messaging

- Private messages: list conversations, view/send messages, mark read/acknowledged, delete conversation.
- Chat rooms: join/leave, list joined vs. available rooms, view messages/users, send messages, set room ticker/topic, add members to private rooms.
- Real-time delivery over SignalR for messages, room mentions, and "user browsed your files" events.
- Desktop notifications (toast + optional sound) and an in-app Notification Centre, independently toggleable per event type.
- Push notifications via Pushbullet mirroring PMs and room mentions.

## Users

- User info/status lookup: presence, privileged flag, endpoint, description, picture, upload-slot/queue info, aggregate stats.
- Browse a user's shares (folder tree) or request a single directory.
- Batch status lookup for many usernames at once.
- IP geolocation (local GeoLite2 database) plotted on a world Map alongside the server's own configured location.

## Music library

- Central SQLite- or PostgreSQL-backed catalogue: cancellable sync, track/genre/year/folder/album/artist listings, recently added, history and loved tracks. Scans include subfolders under configured shared library locations.
- Saved Browse, Prepare and Export table layouts, with column visibility/order/width preferences, DJ filters, saved filters, analysis status and bulk selection actions.
- Track inspection before playback; selection actions include analysis, playlist preparation and export where permissions allow.
- Smart crates with saved rules for BPM, harmonic key neighbours, genre, energy, vocals, analysis, folders, recency and listening history. Results follow the current library.
- Preparation view with durable queue status, pause/resume and retry controls.
- Signed, HMAC-based streaming/artwork URLs with configurable TTL.
- Batch/inline track and folder metadata editing, including local-only batch delete.
- **Metadata lookup / auto-tagging** — background enrichment from MusicBrainz, Discogs, Last.fm, and Deezer, with a configurable minimum match score, manual preview, and force-run.
- **Tag Manager** and a tag-sanitization scanner/consolidator.
- **Duplicates** — dedicated library duplicate detection with folder-name normalization/grouping.
- **Audio Converter** — background conversion job queue backed by a managed, self-updating ffmpeg.
- **Playlists** — create/edit playlists, reorder tracks, set artwork, publish through a no-login token link, export as `.m3u` or download as `.zip`. Confirmed deletion removes the playlist and its generated assets, leaving original library tracks in place.
- **yt-dlp ingestion** — search or direct-URL jobs, configurable audio format/quality/output template, duration filters, SponsorBlock stripping, bandwidth/concurrency limits, auto-retry sweeps, post-download conversion, channel/playlist subscriptions with polling, and cookie management (paired with a browser extension that syncs YouTube cookies for age-restricted content).

## Analysis and automatic preparation

- Newly indexed Soulseek downloads, completed yt-dlp output and unfamiliar files within configured library roots enter the persistent preparation queue. Existing tracks missing required analysis are also reconciled.
- Preparation processes one track at a time, yields to playback, manual analysis and metadata/tag updates, reuses valid completed work, recovers interrupted jobs and retries failures with backoff.
- Basic analysis shares one decode for requested BPM, key, waveform peaks and EBU R128 loudness metrics. Per-metric selection, worker count, skip-completed and cancellation are available.
- BPM/key detection uses a configured Essentia environment, with a selectable key profile and preferred BPM range for half/double-time handling. Waveform and loudness can run without Essentia when ffmpeg is available.
- Waveform analysis caches per-band peaks; loudness analysis includes integrated LUFS, true peak and loudness range.
- Basic analysis stores detections in the cache and can write BPM/key tags. `analysis.write_to_tags` currently defaults to `true`; set it to `false` to preserve source tags. Explicit metadata edits remain separate write actions.
- Optional independent enhanced workers add full-track beats/downbeats, genre and energy estimates, singing/processed-voice regions, musical structure, DJ phrase labels and loop candidates. DJ and musical phrase labels are separate views.
- Enhanced workers read source audio and store separate results. Model weights, runtime environments and private analysis configuration are not bundled or automatically installed by the source build.
- Missing engines and failed work remain visible as incomplete/unavailable. Genre, vocal and phrase results are estimates, not guaranteed annotations; uncertain DJ sections can use neutral labels.
- Rekordbox import remains an optional migration path for existing saved results. Independent analysis does not require Rekordbox to be installed, licensed or running.

See [automatic preparation](docs/auto-analysis.md), [worker setup](docs/dj-workspace.md#independent-enhanced-analysis) and [beatgrid verification](docs/beatgrid-verification.md).

## Set planning and rehearsal

- **Auto-Mix** — builds a Camelot-neighbour queue from a seed track's key/BPM and a configurable BPM tolerance.
- **Mix compatibility** — compares tempo, key, genre evidence, energy, vocals and candidate phrase handovers.
- **Genre warnings** — distinguish cross-genre pairings, unknown genres and conflicts between tags and predictions. The source-reviewed genre guide is conservative guidance, not a verified list of individual tracks that will mix successfully.
- **Transition preview** — plays the ending of one track against the opening of the next, with a crossfader and pitch-preserving tempo synchronization when supported by the saved timing.
- **Set planner** — saved, ordered plans assembled from the library, folders or smart crates, with transition analysis, playlist and USB-export actions.
- **Full-set rehearsal** — auditions consecutive handovers at one fixed master tempo from beginning to end. It defaults to the first track's BPM, or uses a manually selected master. Unsupported timing or tempo combinations are explained rather than silently changing tempo.

These are preparation and audition tools. A numerical compatibility result or successful rehearsal does not establish that the source analysis is musically correct.

## Player and waveforms

- Docked playback and a separate player window share one audio stream, transport, queue and current-track metadata. The separate window opens from the player-window button; clicking docked artwork does not open an additional player view.
- BPM, key and LUFS information, artwork, history, loved tracks, shuffle/repeat, volume and level metering. The Up Next queue starts closed.
- Optional waveform display with seeking, adjustable height, detected beat/downbeat markers, coloured phrase regions and vocal overlays where analysis is available.
- Waveform detail levels: **Normal, 16×, 32×, 64×, 128× and 256×**. Detailed views follow the playhead; waveform detail is independent of interface scale.
- Separate **DJ phrases**, **Musical phrases** and **Hide phrases** settings; singing and processed voice have distinct overlay labels.
- Audio processing starts bypassed. Bypass excludes effects and loudness normalization while retaining player volume. Enabling processing offers subtle controls; wider parameter ranges require explicitly unlocking advanced controls.
- Theme-aware waveform rendering in the docked and separate player views; optional artwork-derived ambient colour.
- SSDP discovery and casting to DLNA renderers; optional DLNA/UPnP media server with configurable name, port and artwork.

## Pioneer export and Network Link (experimental)

- USB export from library selections, set plans or a dedicated wizard: select tracks, choose player/profile and playlist, review, then prepare and transfer.
- Folder-aware selection includes tracks inside folders; the source folder hierarchy is not preserved as the USB layout.
- Optional Python exporter prepares classic and OneLibrary databases and available waveform/beatgrid analysis. The dual profile includes both database formats.
- One native desktop helper handles USB Export and Network Link through `.resonance` action files and a loopback dashboard. The browser prepares the export; the installed helper writes to the selected drive.
- USB transfer verifies the bundle, requires an explicit destination and write action, refuses overwrites, does not format drives and verifies written files against their SHA-256 inventory.
- Network Link serves the prepared **whole library**, without a track picker. The helper checks for revised library bundles every 15 seconds; newly indexed tracks become available after full preparation completes.
- The helper runs on the players' IPv4 LAN. The main Resonance server may run elsewhere. Saved, revocable server connections survive helper restarts; player sharing starts off each time.
- Source and installer tooling cover macOS Apple silicon, Windows x64 and Linux amd64. Development installers are unsigned/not notarized; native Windows/Linux acceptance remains pending.

Physical USB and network/player validation is still required, including OPUS-QUAD. A USB-enabled player does not necessarily support network LINK EXPORT. The network engine currently queries the classic database, even when a dual-format bundle also contains OneLibrary. See the [Resonance Bridge guide](desktop/bridge/README.md).

## Integrations

- **FTP** — auto-upload completed downloads to a remote server (explicit/implicit/auto encryption), configurable path/overwrite/timeout/retries.
- **Webhooks** — fire HTTP calls on configurable events, with custom headers, TLS-ignore option, timeout, retries.
- **Scripts** — run a shell command or external executable on configurable events.
- **Pushbullet** — push notifications for PMs/mentions with title prefix and cooldown.
- **VPN (Gluetun)** — polls a Gluetun container for connection status/public IP/forwarded port; acts as a kill switch that disconnects the Soulseek client if the VPN drops, with dynamic port-forwarding sync.
- **UPnP** — automatic port-forwarding request from the local gateway, with configurable lease duration.
- Metadata sources: MusicBrainz, Discogs, Last.fm, Deezer (see Music Library).

## Relay (distributed operation)

- Controller/agent mode — one controller instance directs one or more agents that hold shared files and perform transfers.
- Per-agent shared secret and CIDR allow-list.
- Agents push completed downloads, file listings, and share manifests to the controller.
- Optional "optimistic" relay file info to skip re-querying an agent before enqueueing.
- Agents run a reduced, System-only frontend UI.

## Telemetry

- Prometheus metrics endpoint (independently toggleable basic-auth) plus a KPI summary endpoint.
- Extensive transfer analytics: summary/histogram, per-user leaderboard, exception listing and Pareto analysis, per-file/per-directory stats, geography/heatmap views, retry statistics, queue-wait times, peer stats, coverage, and aggregate "social" stats.
- HTTP capture/export as `.har` for debugging.
- Structured logging with **Database** storage by default; **Disk** and **Both** modes are available in System → Options → Logging. The Logs page reads the active store. Changing the storage mode requires a restart.
- Retention for disk/SQLite logs and PostgreSQL partition maintenance; independent console logging, optional Grafana Loki shipping and EF Core SQL query logging.

## Storage and migration

- SQLite is the persistent, zero-configuration default. Existing PostgreSQL connection strings continue selecting PostgreSQL; an upgrade does not silently migrate or replace an existing database.
- Explicit PostgreSQL support, provider-specific schema initialization and SQLite share caches.
- Voluntary PostgreSQL-to-SQLite migration into a new destination, with a read-only source snapshot, row counts, checksums and SQLite integrity checks before publishing the result.
- Migration copies database records and share caches. Audio and external artwork/analysis assets require separate copying or accessible configured paths.

See [database configuration, logging, migration and backup](docs/database/architecture.md).

## Auth, multi-user & permissions

- Three auth schemes: JWT (configurable token/refresh TTL, idle timeout), API Key (role- and CIDR-bound, multiple keys), and Passthrough (for trusted reverse-proxy setups).
- Genuine multi-user accounts: create/list/delete users, change password/username/full name/role.
- Role-based access with built-in roles (`ReadOnly`, `ReadWrite`, `Guest`, `Administrator`) plus custom roles.
- Fine-grained per-role feature permissions: search, transfers, library, messaging, user-browsing.
- Session management — list/revoke active sessions (or all), server-pushed forced logout on remote revocation.
- Login rate limiting.
- Reverse-proxy friendly: unix domain socket listening, custom URL base, forwarded-headers handling.
- HTTPS with self-generated or supplied certificate, force-redirect, independent HTTP/HTTPS bind config.
- Explicit opt-in flags gating remote configuration and remote file management.

## Frontend / UI

- Pages: Overview, Map, Searches, Browse, Users, Chat, Rooms, Uploads, Downloads, Library, Track Analysis, Export, Network Link, Tag Manager, Duplicates, Converter, yt-dlp, System (Info/Options/Permissions/User Management/Shares/Events/Logs/Files/Data/Database Viewer), plus standalone public Playlist and raw Database Viewer routes. Smart crates, preparation and set planning are part of the library workspace.
- Real-time updates via a persistent SignalR hub with automatic reconnect/backoff and a reconnecting overlay.
- Daylight, AMOLED, Midnight, Ultraviolet and Ember themes, with cross-tab synchronization.
- Main and library navigation rails expand on hover or keyboard focus; compact spacing keeps the desktop workspace available. Status information retains the same shell across routes.
- Interface scale has manual presets of 50%, 67%, 75%, 80%, 90% and 100%. **100% is normal size**, not a fit command. **Auto size** selects a scale for the current desktop window and never enlarges beyond 100%.
- Notification Centre with per-type mute toggles, read/unread tracking, clear-all, optional sound.
- Persistent docked player and separate player window (see Player and waveforms).
- First-run Setup wizard.
- Distinct "connecting" (first load) vs. "lost connection" (mid-session) states with manual retry and backoff.
- Desktop-oriented web layout; compact interface scale does not imply a phone layout. The companion React Native app and cookie-sync browser extension are separate applications.

## Android and iOS companion apps

The [mobile guide](mobile/README.md) includes native screenshots, build status and a platform comparison. This is an evolving source snapshot: features and design can change, and more features are being added.

- Discover home with listening history, recent artwork shelves, unheard arrivals and saved playlists; five primary tabs with community and share browsing under More.
- Explained track matching by BPM, harmonic key and available analysed RMS energy proxy; audition, queue and file suggestions into playlists.
- Account-scoped wanted searches with daily foreground rechecks, search activity, arrival triage and completed-download visibility.
- Offline-persistent preparation notes, set roles and listening bookmarks, with revision-aware server sync and explicit conflict resolution. Desktop track inspector reads the shared preparation and bookmarks.
- Original-audio offline playlist crates with progress, cancellation, refresh, storage use and removal. Completed audio persists per account/server; background download completion is not guaranteed.
- Server-address sign-in or short-lived QR pairing, secure session storage and live connection updates.
- Server library browsing by artist, album, track, folder, genre and year; search, sorting, list/tile layouts, loved tracks and history.
- Mini-player and full-screen player with artwork, waveform seeking, queue selection, shuffle/repeat and available BPM, key, LUFS and genre metadata.
- Automatic, Original and Data saver streaming quality; native background playback and Google Cast controls.
- Handset Studio rack with separate Headphones/Speakers settings, eight-band EQ, dynamic bass and treble control, and Resonance Enhance, Deep & Clean and Smooth Detail presets. Preset Amount scales the complete rack; saved presets include tone settings.
- Level-matched dry/processed A/B and a fixed −1 dBFS sample-peak guard. Studio applies to handset playback, requires the version 2 native build for tone controls, and does not process Cast receiver audio.
- Create, rename, delete, edit, reorder, play and share server playlists, subject to account permissions.
- Separate handset-only playlists for local music on Android and iOS: create, rename, delete, add/remove/reorder tracks and play, without server playlist calls or synchronization. Local collections remain on the handset across server changes and sign-out.
- Soulseek search, shared-folder browsing and transfer management; rooms, mentions and private chat.
- Role-dependent overview, server, connection, logs and relay screens.
- Light, Dark, AMOLED and Midnight themes, system appearance, notification preferences, and optional diagnostic logging.
- SQLite metadata/artwork caches for repeat browsing. Cached server metadata is distinct from downloaded audio.
- Android-specific local audio-library support, Storage Access Framework folder/USB copying, Android Auto browse/playback, an optional native floating overlay and APK update flow. iOS does not inherit these platform capabilities; its local audio-library access needs separate validation.

The mobile USB copy action copies local audio files; it does not create the desktop Pioneer export databases or analysis files. Desktop set planning, full-set rehearsal and detailed beat/phrase overlays are not implied mobile features. Native screenshots cover the displayed server-library/player screens, not external hardware, push delivery or production-store acceptance.

## Notable configuration-driven behaviors

- `remote-configuration` / `remote-file-management` flags gate remote settings/file changes via the API.
- Configurable downloads/incomplete-downloads directories.
- Swagger UI toggle for interactive API docs.
- Persistent SQLite by default, with PostgreSQL support and an explicit migration tool. Logging can use Database (default), Disk, or Both.
- SOCKS/HTTP proxy support for the Soulseek connection itself, independent of the VPN integration.
- Toggleable participation in Soulseek's distributed search network with child-connection limits.
- Configurable server geographic location, feeding the Overview Map's self-marker.

## Documentation maintenance

Keep feature descriptions tied to the implementation. Mark configured and experimental capabilities explicitly; distinguish saved-analysis rendering checks from musical accuracy and physical player acceptance. Date verification evidence rather than presenting a past test run as a permanent guarantee.

Use plain headings and descriptive links without decorative emoji or icon prefixes. Update this inventory and the relevant operating guide when behaviour or defaults change. The [modification summary](CHANGES.md) provides context; Git history remains the authoritative record of changes.
