# Features

Resonance is a Soulseek file-sharing client with an integrated music library, metadata/analysis pipeline, and multi-user web UI. This document is a feature inventory of what the application currently does.

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
- Duplicate detection across the library — a dedicated Duplicates page with folder-name normalization/grouping.

## Music library

- Central SQLite- or PostgreSQL-backed catalog: stats, sync/re-sync (cancellable), track/genre/year/folder/album/artist listings, recently-added, and "keyed" (analyzed) listings.
- **Track analysis** — one background scan produces BPM, musical key, waveform peaks and EBU R128 loudness from a *single* decode per file, with per-metric selection, worker count, resume and cancel.
  - **BPM** — Essentia beat tracking with octave-folding to a preferred range to correct half/double-time errors, tag write-back, manual override.
  - **Key** — Essentia key detection (EDM-tuned `edma` profile plus krumhansl/temperley/bgate), displayed/sorted using Camelot wheel notation for harmonic mixing.
  - **Waveform** — per-band peak data cached for the player's seek bar, plus a single-track waveform inspector with zoom and draw modes.
  - **Loudness** — integrated LUFS, true peak and loudness range, surfaced by the player's loudness meter.
- **Auto-Mix** — builds a harmonically-compatible (Camelot-neighbour) play queue from a seed track's key/BPM within a configurable BPM tolerance.
- **Playback** — in-app media player with persistent "Up Next" queue, play history, loved/favorite tracks, browsing by album/artist/genre/year/folder.
- **Ambient theming** — dominant colour extracted from now-playing album art tints the UI chrome.
- **Casting** — SSDP discovery of DLNA renderers and cast-to-device; Resonance can also act as its own DLNA/UPnP media server (configurable friendly name, port, artwork-in-browse).
- Signed, HMAC-based streaming/artwork URLs with configurable TTL.
- Batch/inline track and folder metadata editing, including local-only batch delete.
- **Metadata lookup / auto-tagging** — background enrichment from MusicBrainz, Discogs, Last.fm, and Deezer, with a configurable minimum match score, manual preview, and force-run.
- **Tag Manager** and a tag-sanitization scanner/consolidator.
- **Audio Converter** — background conversion job queue backed by a managed, self-updating ffmpeg.
- **Mixtapes** — create/edit playlists, reorder tracks, custom artwork, publish publicly via a shareable no-login token link, export as `.m3u`, download as `.zip`.
- **yt-dlp ingestion** — search or direct-URL jobs, configurable audio format/quality/output template, duration filters, SponsorBlock stripping, bandwidth/concurrency limits, auto-retry sweeps, post-download conversion, channel/playlist subscriptions with polling, and cookie management (paired with a browser extension that syncs YouTube cookies for age-restricted content).

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
- Structured logging with optional Grafana Loki shipping, disk logging, console color toggle, and EF Core SQL query logging, viewable via a Logs page.

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

- Pages: Overview, Map, Searches, Browse, Users, Chat, Rooms, Uploads, Downloads, Library, Track Analysis, Tag Manager, Duplicates, Converter, yt-dlp, System (Info/Options/Permissions/User Management/Shares/Events/Logs/Files/Data/Database Viewer), plus standalone public Mixtape and raw Database Viewer routes.
- Real-time updates via a persistent SignalR hub with automatic reconnect/backoff and a reconnecting overlay.
- Light and AMOLED themes, system dark/light auto-detection, cross-tab sync.
- Collapsible sidebar navigation with polled unread badges (chat, rooms, downloads, uploads).
- Notification Centre with per-type mute toggles, read/unread tracking, clear-all, optional sound.
- Persistent bottom player bar with an expandable "Up Next" queue, waveform seek bar, and cast control.
- First-run Setup wizard.
- Distinct "connecting" (first load) vs. "lost connection" (mid-session) states with manual retry and backoff.
- Companion React Native mobile app mirroring core flows, and a browser extension for YouTube cookie sync.

## Notable configuration-driven behaviors

- `remote-configuration` / `remote-file-management` flags gate remote settings/file changes via the API.
- Configurable downloads/incomplete-downloads directories.
- Swagger UI toggle for interactive API docs.
- Persistent SQLite by default, with PostgreSQL support and an explicit migration tool. Logging can use Database (default), Disk, or Both.
- SOCKS/HTTP proxy support for the Soulseek connection itself, independent of the VPN integration.
- Toggleable participation in Soulseek's distributed search network with child-connection limits.
- Configurable server geographic location, feeding the Overview Map's self-marker.
