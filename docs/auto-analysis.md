# Automatic library preparation

Newly indexed tracks enter a persistent preparation queue. This applies to Soulseek,
yt-dlp, and unfamiliar folders copied into a configured library root. Folder scans
include subfolders. An external folder must first be added to the configured shared
library locations; Resonance does not scan arbitrary disks.

The library emits `NewTracksIndexed` after committing its scan. `PreparationService`
responds by reconciling indexed tracks with available analysis. It also reconciles
at startup and at least once per minute, so a missed event does not lose work.
Completed, unchanged analysis is reused. BPM/key tags alone do not count as complete
waveform, loudness or enhanced analysis.

Preparation processes one queued track at a time through `AnalysisService`. It
waits while playback is active, a manual analysis scan is running, or metadata/tag
updates are active. An explicit pause persists across restarts. Stopping analysis
pauses automatic preparation rather than immediately restarting the cancelled job.
Interrupted jobs recover on startup. Failed work retries with backoff, up to three
attempts; Library → Preparation exposes its status and a manual Retry action.

## Analysis engines

Basic analysis provides BPM, key, waveform and loudness. With the optional independent
worker configured, the same queue also prepares beat/downbeat grids, genre, energy,
singing/processed voice and DJ/musical phrases. These are independent estimates;
uncertain DJ sections use neutral labels. They do not require Rekordbox.

Missing engines or model assets are reported as unavailable or failed rather than
represented as successful full analysis. See [worker configuration](dj-workspace.md).
Original audio tags are preserved by the normal analysis path; detected values are
stored in the analysis cache and exposed by the library/player.

## Detection timing

Soulseek directory completion requests an immediate library sync. yt-dlp requests a
sync after publishing completed output, coalescing bursts of jobs. Filesystem changes
are debounced for 30 seconds and watcher scans have a five-minute minimum interval
after the previous scan. A periodic safety scan handles missed filesystem events.
Indexing and CPU-intensive analysis are separate steps, so arrival is not an instant
promise of completed analysis.

## Implementation and verification

- `backend/MusicLibrary/MusicLibraryService.cs`: configured roots, recursive indexing,
  filesystem detection and `NewTracksIndexed`.
- `backend/MusicLibrary/Workspace/PreparationService.cs`: reconciliation and processing.
- `backend/MusicLibrary/Workspace/WorkspaceStore.cs`: durable status, retries and pause.
- `backend/Analysis/AnalysisService.cs`: missing-analysis rules and independent worker.
- `tests/WorkspaceTests.cs`: busy/playback guards, interruption recovery, retries and
  preservation of completed analysis on SQLite and optional PostgreSQL.

The queue is visible under Library → Preparation. Logging defaults to database storage
and is available in System → Logs; disk output is optional.
