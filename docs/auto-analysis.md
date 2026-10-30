# Automatic library preparation

Updated **21 October 2026**. This describes current scheduling and defaults; both can
change. See the [feature inventory](../FEATURES.md) for the wider product scope.

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
represented as successful full analysis. Basic BPM/key detection needs a configured
Essentia Python environment; waveform and loudness still work with ffmpeg when that
environment is missing. Enhanced model assets and environments must be installed
separately. See [worker configuration](dj-workspace.md#independent-enhanced-analysis).

Before decoding or clearing saved results, a basic scan checks any required BPM/key
packages and the decoder. A missing interpreter or broken package environment stops
the entire scan with an actionable error. If a dependency disappears during a scan,
the remaining work stops too. Automatic preparation pauses on this failure instead
of consuming every track's retry budget. The error appears on Library Home,
Preparation and Analysis. Repair the environment, then explicitly resume/retry.
Results missing a requested measurement count as failed, even if waveform or
loudness was produced; partial results are retained without being called complete.

Native backend publishes include the [basic-analysis provisioning kit](../tools/native-analysis/README.md).
Its pinned installer and real detector preflight are required deployment steps;
the configured interpreter lives outside application releases and its path is
saved in persistent settings. A native host must not inherit Docker's
`/opt/keyenv/bin/python` path without provisioning it. Existing waveform/loudness
results are retained when filling missing BPM/key; no full-library reset is needed.

## Source tags and saved results

Automatic preparation uses the same basic analysis options as a manual scan.
`analysis.write_to_tags` currently defaults to `true`, allowing detected BPM and key to
be written to audio tags. Set it to `false` to keep detections in the analysis cache
without those tag writes. Explicit metadata/tag edits are separate write actions.

In the application settings' YAML representation:

```yaml
analysis:
  write_to_tags: false
```

The independent enhanced worker reads audio and saves separate results; it does not
write source tags. Rekordbox results can optionally be imported for migration, but
independent analysis does not require Rekordbox. Vocal and phrase labels remain
estimates, and beatgrid rendering tests do not establish musical accuracy.

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
