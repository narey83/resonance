# Beatgrid rendering verification

Updated **21 October 2026**. This is a repeatable check of the current renderer and
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
mounts the real `WaveformSeekBar` in the main document and a separate window document.
It imports the toolbar's selectable zoom levels, currently **Normal (1×), 16×, 32×,
64×, 128× and 256×**, so its selections follow the player rather than an obsolete
hard-coded list.

Five canvas configurations exercise widths of 420, 987 and 1,595 pixels, differing
heights and pixel densities of 1, 1.25 and 2. Across 15 tracks, two document modes and
six zoom levels, this produces **900 cases and 16,200 frames**. Checks cover:

- Scrolling frames and track boundaries.
- Forward and backward clock jumps and pointer seeking.
- Beat/downbeat pixel alignment, including fractional scaling.
- Sparse overview lines counted from the downbeat phase.
- Player-window opening, reuse, closing and blocked-window handling in related tests.

The repository's [CI workflow](../.github/workflows/ci.yml) runs the frontend test suite
on main pushes and pull requests. A passing local run does not establish a successful
remote CI run; review the checks for the particular commit.

## Recorded verification

On **21 October 2026**, the command above passed **118 tests in six suites** against
the renderer in source commit `bef94b8`. The generated report confirmed 15 tracks,
all six selectable zoom levels, docked and separate-window document modes, **900
cases and 16,200 frames**, with every matrix case aligned to its saved timestamps.
This was an automated local run; no new live-browser or hardware acceptance is
implied by this documentation update.

## Interpretation

These checks establish rendering consistency with the saved timestamps. They do not
establish that every detected beat/downbeat is musically correct, certify phrase or
vocal labels, or guarantee every browser/operating-system combination. A separate
browser review should include docked and player-window views, themes, window sizes
and interface scale. Physical Pioneer playback remains a separate hardware task.

The 15 October 2026 browser checks exercised the controls available at that time.
Those historical results are not evidence that later controls or browser versions
have already passed the same review.
