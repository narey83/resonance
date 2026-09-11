# Automatic analysis on new downloads

How Resonance keeps BPM, key, waveform, and loudness populated — and correct — the moment
a track lands in the library, without waiting for someone to run a manual scan.

## The problem this solves

Two separate gaps, fixed together because they share one pipeline:

1. **A track's BPM tag can be wrong at the source.** It's read straight from the file's own
   metadata, and taggers on DJ-pool releases sometimes get it wrong by a clean factor of 2
   or 4 (half-time, quarter-time) — e.g. `TEMPO=42` on a track that's really 168 BPM.
2. **Analysis only ever ran when a human clicked "scan."** A freshly downloaded track sat
   with no waveform, no loudness reading, and (per #1) possibly a wrong BPM, until someone
   remembered to run one manually.

## The pieces

```mermaid
sequenceDiagram
    participant DL as Soulseek download
    participant Lib as MusicLibraryService
    participant An as AnalysisService
    participant Ess as Essentia (ffmpeg + Python)
    participant Tag as File tag (on disk)
    participant Player as Web / mobile player

    DL->>Lib: DownloadDirectoryCompleteEvent
    Lib->>Lib: RunSyncAsync — reads tags for new files
    Lib->>An: NewTracksIndexed(paths of every newly-added track)
    An->>An: WaitForPlaybackIdleAsync()
    Player-->>An: RecordPlaybackActivity() on every /stream request
    Note over An: polls every 10s while playback is active;<br/>gives up after 10 min regardless
    An->>An: MissingMetrics per track (Bpm | Key | Waveform | Loudness)
    Note over An: Every missing metric is included; existing valid results are preserved
    An->>Ess: StartScanAsync (one decode per track, only the missing metrics)
    Ess-->>An: waveform bands, loudness (LUFS/peak/LRA), key, folded BPM
    An->>Tag: write corrected/detected BPM + key back to the tag
    Tag-->>Lib: next sync re-reads the fixed tag into music.tracks
```

## Where the logic lives

| Concern | File | What it does |
|---|---|---|
| Reads the raw tag on every sync | `backend/MusicLibrary/MusicLibraryService.cs` (`ReadTrack`) | `Bpm`/`Key` come straight from the file's own tags — no validation at this point, by design (this is also how a manually-corrected value flows back in after analysis writes it). |
| Detects "new track" | `backend/MusicLibrary/MusicLibraryService.cs` (`RunSyncAsync`) | While reading new/changed files, collects the path of every *newly added* track, then raises `NewTracksIndexed` once the sync commits. |
| Decides whether to trust an existing BPM tag | `backend/Analysis/AnalysisService.cs` (`HasReliableBpm`) | Runs the tag value through `AudioAnalyzer.FoldOctave` using the same `MinBpm`/`MaxBpm` window a computed detection is folded into (default 88–176). If folding would change the number, the tag is untrustworthy. |
| Decides which metrics a track still needs | `backend/Analysis/AnalysisService.cs` (`MissingMetrics`) | Per track: Key/Waveform/Loudness are missing if not already cached; BPM is missing if absent or if its tag fails `HasReliableBpm`. |
| Reacts to the event | `backend/Analysis/AnalysisService.cs` (`OnNewTracksIndexed`) | Subscribed in `StartAsync`. Resolves the new tracks' masked filenames and requests the same missing-only `AnalysisMetrics.All` scan used by playback and the UI. |
| Waits for a quiet moment | `backend/Analysis/AnalysisService.cs` (`WaitForPlaybackIdleAsync`, `RecordPlaybackActivity`) | The stream endpoint (`MusicLibraryController.StreamTrack`) calls `RecordPlaybackActivity()` on every request — web and mobile share the same endpoint. The auto check polls until 45 seconds have passed with no stream activity, or gives up after 10 minutes and runs anyway. |

## Behaviour

- **Uses one missing-only rule.** Playback, Library actions, the Analysis page, and automatic
  post-download analysis all fill missing BPM, key, waveform, and loudness values. Existing
  valid results are preserved; reset-and-rescan is the explicit overwrite path.
- **Never runs while something is actively streaming.** The whole point is to avoid a
  CPU-heavy ffmpeg+Essentia decode competing with live playback on a small host. It waits,
  it doesn't skip — nothing is silently left unanalysed just because someone was listening.
- **Never touches the whole library.** Only the tracks a given sync just added are scanned;
  existing tracks are unaffected until playback or a manual scan applies the same rule.

## Logging

Look for these lines in `backend/logs/resonance-*.log` (source context `Music.Analysis`):

- `Auto analysis: playback is active — waiting for it to go idle before analysing new tracks.`
- `Auto analysis: playback went idle — proceeding.`
- `Auto analysis: gave up waiting for playback to go idle after 10 minutes — proceeding anyway.`
- `Skipped auto analysis for N new track(s) — a scan was already running.` (a manual scan
  was in progress at the same moment; rare, and the next manual/auto scan will still catch
  these tracks)

The scan itself then logs through the normal `Analysis scan started` / `Analysis scan
complete` lines shared with manual scans.
