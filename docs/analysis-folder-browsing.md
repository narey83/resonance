# Analysis folder browsing

The Analysis page previously fetched the complete track list in successive
10,000-row requests, then grouped those rows in the browser. A folder could show
three tracks, then twelve, then its actual forty tracks as unrelated pages arrived.
The 59,413-track library needed at least six requests before every folder count settled.

## Folder totals first

`GET /musiclibrary/folders` returns complete indexed totals grouped by directory.
Optional `search` and `analysis` parameters use the same matching rules as track
queries. The existing unfiltered response shape and cache are preserved. No source
audio, tag files or candidate reports are opened to answer this request.

The browser renders folder names and totals without fetching track records. These
totals describe the matching library, independent of which track windows have
been fetched. Do not derive folder badges from the currently cached tracks.

## Track windows

Expanding a folder creates lightweight virtual row positions using its known
count. A single page virtualizer requests the windows intersecting its viewport
and overscan. Each request contains at most 200 tracks and uses `recursive=false`
to match the directory whose total is displayed. Existing callers retain the
recursive folder-query default. Sorting and filtering remain server-side, with
the existing unique path tiebreaker for stable pagination.

The shared cache permits two concurrent requests and retains at most 32 completed
windows. Queued off-screen work is removed and active off-screen requests are
aborted. Changing the query or leaving the page also cancels obsolete work.
Jumping to a folder's end requests that window directly; preceding tracks do not
need to be downloaded. Refreshes keep known rows visible while replacing the
windows currently in view. Errors expose a retry, and an empty window after a
folder changes exposes Refresh rather than looping indefinitely.

## Selection and analysis

Individual selections retain path and directory identity. Explicit folder/all
selection resolves the complete matching set in bounded requests, independently
of the windows on screen. Bulk selection disables scan actions until its scope
is resolved. Folder scan actions likewise resolve the full direct folder across
the server's 10,000-row limit. Readiness-result changes clear obsolete selections.
An unselected library-wide scan remains a server-side operation. Merely opening,
expanding or scrolling folders starts no analysis and no playback.

## Verification

The change passed 33 frontend regressions, five dependency-security tests,
132 backend regressions, Release/StyleCop compilation and production builds on
the dev laptop. The final frontend refinement reused backend checks only after
verifying all backend/test sources were hash-identical; dependency-install inputs
were unchanged in the same clean npm 11 snapshot.

Browser tests at 1440, 1100, 800 and 390 pixels used 1,000 folders and 31,324 tracks,
including a 25,330-track folder. Initial folder display made zero track requests;
opening that large folder fetched one 200-track page. Opening it and jumping to
the expanded list's last track required only six or seven track requests in total.
The last folder/track stayed reachable, fewer than 100 rows were rendered, and
results retained a single page scroll area.

A read-only five-run check of the production SQLite folder-summary SQL returned
75 folders / 59,413 tracks in a median 37.2 ms. This measures the SQL query, not
end-to-end browser loading. PostgreSQL was not exercised during this deployment.
Existing dependency audit and source-map warnings remain; no dependencies or
database schema were changed.


## Analysis workspace review — 2 November 2026

Switching between Track Analysis and Waveform Inspector retains the analysis
search, readiness filter, sorting, selected tracks, expanded folders and scan
options in the current page session. The inspector also retains its chosen track.
Inactive views unmount their requests and audio resources; this state is local to
the page, not a second copy of the library or a persistent user setting.

Waveform search queries the entire indexed library with a debounced, cancellable
eight-result request. It no longer preloads or searches only the first 5,000
tracks. Loading, no matches and failed requests are visible, with retry and keyboard
selection. Obsolete replies cannot replace a newer search. Tabs expose selected
state and support arrow, Home and End navigation; folders expose expanded state.

The waveform and display controls appear before the optional saved/independent
analysis forms. Those forms start collapsed and load on demand. Changing waveform
style first reads cached frequency data, falling back to browser-only decoding;
it no longer starts a new Basic scan just to inspect a track. Explicit generation
and scan actions remain available. Idle scans omit the unusable Stop button;
running scans and their stop/completion behaviour remain covered by tests.
The activity lifecycle re-arms after component hot refresh so live scan polling
continues while preserving the current selection.

Dev-laptop verification: 136 frontend tests across 15 suites, lint, 11 dependency
security checks and zero dependency advisories. Authenticated desktop and phone
checks reconciled 59,413 total / 43,041 Basic-ready / 35 Enhanced-ready tracks,
searched beyond the old window, retained selection and search through tab changes,
opened track details, decoded the waveform and displayed frequency bars without
starting analysis or changing settings. Screenshots were inspected. Development
compilation/hot reload was used; no production build or backend restart was needed.


## Pause, Resume and End scan

The primary action is Pause after current tracks, changing to Resume scan once
pause is requested. New admissions stop atomically; Basic and Enhanced work already
admitted finishes and saves normally. The same server-side queue stays held, even
if the browser reloads. Pausing a scan does not change the separate automatic
preparation setting. A paused queue is held in memory and does not survive a
backend restart.

End scan is a secondary action. It first pauses automatic preparation, then ends
new dispatch while active tracks finish. The remaining manual scan queue is
abandoned; completed results stay saved, and unfinished library tracks can be
selected again. The durable automatic-preparation queue is retained and paused.
The immediate-cancellation API remains available for existing clients.

Authenticated write-role APIs: POST `/analysis/scan/pause`, `/analysis/scan/resume`
and `/analysis/scan/end`. They return 204 or 404 when no controllable queue remains.
GET `/analysis/scan` adds `supportsPause`, `pauseRequested`, `paused`, `ending` and
`enhancedInFlight`. Pause is reported as complete only after both worker types
have drained. Resume after End is rejected. The frontend uses the new controls
only when the server advertises support, retaining the older controls until the
native backend is updated.

The dispatch gate is independent of the active-work cancellation token. Graceful
End cancels channel/parallel dispatch and releases paused waiters, while existing
decodes use the original run token. Admission and pause/end serialize under one
lock; Basic worker progress publications are serialized so simultaneous finishes
do not leave a stale active count. Shutdown/immediate cancellation still cancels
active work. No database schema or dependency changes are required.

Prepared verification: 153 Analysis/Workspace backend tests; 55 Analysis frontend
tests; warning-free backend build/publish; detector preflight; lint, 11 dependency
security checks, and zero npm/NuGet advisories. Desktop/phone browser previews use
controlled scan responses for pause/drain/resume/end, with live control endpoints
intercepted so the current running scan is unaffected. Activation requires a
backend restart; preparing the feature does not apply it to an already running
native process.

Background auto-analysis has its own collapsed settings panel below the manual
scan setup, separate from Current analysis. Its On/Off status and Turn on/Turn off
controls apply to automatic background jobs; they do not pause or resume a manual
scan. The current scan retains its separate Pause/Resume and End scan controls.
