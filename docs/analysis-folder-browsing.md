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
