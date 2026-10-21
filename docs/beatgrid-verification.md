# Beatgrid rendering release check

Run from `frontend`: `CI=true npm run test:beatgrid`.

The checked-in fixture contains the detected beat and downbeat timestamps from the isolated 15-track library. It contains no audio, login credentials or original file paths. Peak counts are retained; synthetic uniform peak amplitudes isolate timing from waveform shape in the automated renderer tests.

The suite mounts the real WaveformSeekBar in the main document and a separate window document, draws every waveform zoom (1, 2, 4, 8, 16, 32, 64, 128, 192, 254), and checks three canvas sizes and pixel densities (including fractional scaling). It verifies scrolling frames, track boundaries, forward/backward clock jumps, pointer seeking, and beat/downbeat pixel alignment. Sparse overview lines must use the downbeat phase. Popout lifecycle tests cover opening, reusing, closing and blocked windows.

Optional: set BEATGRID_REPORT to an output JSON path for the 900-case, 16,200-frame matrix report. This command is a repeatable local/pre-release check; no existing CI pipeline has been configured in this isolated checkout.

2026-10-15 verification: 97 tests in 6 suites passed, production frontend build passed. The previous average-BPM renderer was temporarily restored as a negative control: alignment assertions rejected it; the corrected source was restored afterward. Live Brave smoke checks covered all 15 tracks in docked and native popout views, all 10 zoom selections in each view, popout maximize/restore and browser scaling. Screenshots and reports are saved in the task outputs/beatgrid-shipping directory.

This verifies rendering consistency with saved analysis timestamps. It does not establish that every detected beat or downbeat is musically correct, nor guarantee every browser/operating-system combination. Physical Pioneer playback remains a separate hardware verification task.
