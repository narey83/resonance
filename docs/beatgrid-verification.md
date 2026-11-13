# Beatgrid rendering verification

Updated **13 November 2026**. This is a repeatable check of the current renderer and
saved analysis, not a certification of musical accuracy or hardware compatibility.
The selectable zoom levels and matrix should be updated when the player changes.

## Run the check

From `frontend/`:

```sh
CI=true npm run test:beatgrid
```

Set `BEATGRID_REPORT` to a writable output JSON filename to retain the matrix report.
Create its parent directory first. For example:

```sh
BEATGRID_REPORT=/tmp/resonance-beatgrid-report.json CI=true npm run test:beatgrid
```

## Current coverage

The [fixture](../frontend/src/lib/__fixtures__/beatgrid-15.json) contains detected beat
and downbeat timestamps from the isolated 15-track library. It contains no audio,
login credentials or original file paths. Peak counts are retained; synthetic uniform
amplitudes isolate timing from waveform shape.

The [matrix test](../frontend/src/components/MediaPlayer/BeatgridShipping.test.jsx)
mounts the real `WaveformSeekBar` in the main document.
It imports the toolbar's selectable zoom levels, currently **Normal (1×), 16×, 32×,
64×, 128× and 256×**, so its selections follow the player rather than an obsolete
hard-coded list.

Five canvas configurations exercise widths of 420, 987 and 1,595 pixels, differing
heights and pixel densities of 1, 1.25 and 2. Across 15 tracks and six zoom levels,
this produces **450 cases and 8,100 frames**. Checks cover:

- Scrolling frames and track boundaries.
- Forward and backward clock jumps and pointer seeking.
- Beat/downbeat pixel alignment, including fractional scaling.
- Sparse overview lines counted from the downbeat phase.
- 16- and 32-bar markers counted continuously on saved downbeats when repeated
  arrangement boundaries support their phase.

The repository's [CI workflow](../.github/workflows/ci.yml) runs the frontend test suite
on main pushes and pull requests. A passing local run does not establish a successful
remote CI run; review the checks for the particular commit.

## Recorded verification

On **21 October 2026**, the earlier matrix passed **118 tests in six suites** against
the renderer in source commit `bef94b8`. It covered docked and separate-window
document modes, **900 cases and 16,200 frames**. The separate player window was
removed on 13 November 2026; the current matrix covers the docked player.
This was an automated local run; no new live-browser or hardware acceptance is
implied by this documentation update.

## Interpretation

These checks establish rendering consistency with the saved timestamps. They do not
establish that every detected beat/downbeat is musically correct, certify phrase or
vocal labels, or guarantee every browser/operating-system combination. A separate
browser review should include the docked player, themes, window sizes
and interface scale. Physical Pioneer playback remains a separate hardware task.

The 15 October 2026 browser checks exercised the controls available at that time.
Those historical results are not evidence that later controls or browser versions
have already passed the same review.

## Schelle audio check — 13 November 2026

Both library copies of Obscure Shape’s “Schelle” were checked against decoded audio
on the dev laptop. Their saved Basic beat lists start at 0.452789 and 0.499229
seconds, one beat after the opening attack. A stable preceding beat slot falls at
about 0.023 and 0.070 seconds. The first visible attack in Chromium’s decoded
audio and the cached waveform begins near 0.035 and 0.085 seconds respectively.
Across the first 64 beats, cached onset measurements follow the saved beat times
by a median of about 12 milliseconds in both copies, with median absolute
deviation near 3 milliseconds. Chromium’s decoded durations agree with the
cached waveform durations to about 0.02 milliseconds. A separate GStreamer
decode has a different MP3 delay treatment and should not set the player’s
timeline offset.

Full-track decoded audio and the stored 200 Hz waveform bands both favor a
32-bar count from the recovered opening beat. Sustained changes recur around
bars 32, 64 and 128; competing changes around bars 24 and 56 make that phrase
phase moderate evidence, not a certain musical label. An eight-bar breakdown
can begin inside a 32-bar span, and a metrical boundary need not have an audible
arrangement change. The check measured signal timing and structure; it did not
include a human listening judgment. The private read-only evidence and plot are
under `/home/narey/resonance-builds/schelle-alignment-20261113-audio/` on the
dev laptop. No audio or saved analysis was changed by this check.
