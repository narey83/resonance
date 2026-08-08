# Automatic BPM validation

How Resonance keeps a track's tempo tag from silently staying wrong after it's downloaded.

## The problem this solves

A track's BPM comes from a tag embedded in the audio file itself. Taggers on DJ-pool
releases sometimes get it wrong — usually by a clean factor of 2 or 4 (half-time,
quarter-time), e.g. `TEMPO=42` on a track that's really 168 BPM. Until this existed,
that bad number was trusted forever: it only got corrected if someone manually ran an
analysis scan on that exact track.

## The pieces

```mermaid
sequenceDiagram
    participant DL as Soulseek download
    participant Lib as MusicLibraryService
    participant An as AnalysisService
    participant Ess as Essentia (ffmpeg + Python)
    participant Tag as File tag (on disk)

    DL->>Lib: DownloadDirectoryCompleteEvent
    Lib->>Lib: RunSyncAsync — reads tags for new files
    Note over Lib: track.Bpm comes straight from<br/>the file's own tag, unvalidated
    Lib->>An: NewTracksTagged(newly-added tracks with a nonzero tag)
    An->>An: FoldOctave(tag value) == tag value ?
    alt tag looks plausible
        An-->>An: do nothing — trust it
    else tag looks implausible (e.g. 42 for a techno track)
        An->>An: WaitForPlaybackIdleAsync()
        Note over An: polls every 10s;<br/>gives up after 10 min regardless
        An->>Ess: StartScanAsync (BPM only, this file)
        Ess-->>An: real detected tempo, octave-folded
        An->>Tag: write corrected BPM back to the tag
        Tag-->>Lib: next sync re-reads the fixed tag
    end
```

## Where the logic lives

| Concern | File | What it does |
|---|---|---|
| Reads the raw tag on every sync | `backend/MusicLibrary/MusicLibraryService.cs` (`ReadTrack`) | `Bpm` comes straight from `tag.BeatsPerMinute` — no validation at this point, by design (this is also how a manually-corrected tag flows back in). |
| Detects "new track, already tagged" | `backend/MusicLibrary/MusicLibraryService.cs` (`RunSyncAsync`) | While reading new/changed files, collects `(Path, Bpm)` for every *newly added* track whose tag is nonzero, then raises `NewTracksTagged` once the sync commits. |
| Decides whether to trust the tag | `backend/Analysis/AnalysisService.cs` (`HasReliableBpm`) | Runs the tag value through `AudioAnalyzer.FoldOctave` using the same `MinBpm`/`MaxBpm` window a computed detection is folded into (default 88–176). If folding would change the number, the tag is untrustworthy. |
| Reacts to the event | `backend/Analysis/AnalysisService.cs` (`OnNewTracksTagged`) | Subscribed in `StartAsync`. Resolves the new tracks' masked filenames and kicks a BPM-only scan — but only for tracks whose tag is already implausible; everything else is left alone. |
| Waits for a quiet moment | `backend/Analysis/AnalysisService.cs` (`WaitForPlaybackIdleAsync`, `RecordPlaybackActivity`) | The stream endpoint (`MusicLibraryController.StreamTrack`) calls `RecordPlaybackActivity()` on every request from web or mobile. The auto check polls until 45 seconds have passed with no stream activity, or gives up after 10 minutes and runs anyway. |

## What it will never do

- **Never fabricates a BPM for an untagged track.** A blank BPM is often correct — ambient,
  spoken word, sound effects — so `NewTracksTagged` only ever includes tracks that already
  carry *some* nonzero tag. Filling in blanks is what the existing manual "scan" feature is
  for, if someone wants it.
- **Never runs while something is actively streaming.** The whole point is to avoid a
  CPU-heavy ffmpeg+Essentia pass competing with live playback on a small host. It waits,
  it doesn't skip — a bad tag still gets fixed, just not mid-listen.
- **Never touches the whole library.** Only the tracks a given sync just added are checked;
  existing tracks are unaffected until someone runs a manual scan (which uses the same
  `HasReliableBpm` check, so it will catch anything this automatic pass missed).

## Logging

Look for these lines in `backend/logs/resonance-*.log` (source context `Music.Analysis`):

- `Auto BPM check: playback is active — waiting for it to go idle before analysing new tracks.`
- `Auto BPM check: playback went idle — proceeding.`
- `Auto BPM check: gave up waiting for playback to go idle after 10 minutes — proceeding anyway.`
- `Skipped auto BPM check for N new track(s) — a scan was already running.` (a manual scan
  was in progress at the same moment; rare, and the next manual/auto scan will still catch
  these tracks)

The scan itself then logs through the normal `Analysis scan started` / `Analysis scan
complete` lines shared with manual scans.
