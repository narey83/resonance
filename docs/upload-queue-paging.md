# Upload queue pages

The web uploads screen requests a bounded pending page instead of transferring the
entire backlog on every refresh. It displays the full pending count and allows
navigation through all pending records. Paging does not cancel, remove, or modify
uploads. Active transfers sort first, followed by waiting records; request time
and ID make ordering deterministic within each priority. Counts and pages are live
and can change as transfers complete or new requests arrive.

`GET /api/v0/transfers/uploads?page=0&pageSize=250` preserves the grouped response
shape and adds `X-Uploads-Total-Pending`. `page` is zero based. Page size must be
between 1 and 500; malformed or overflowing parameters return HTTP 400. Recent
completed history retains its independent 500-record cap. `activeOnly=true` omits
that history. Calls without `page` retain the existing unpaged contract for other
clients.

The uploads page has separate Queue and History tabs. Queue groups unfinished
tracks into Uploading now (sending/connecting) and Waiting to upload, then by
person and folder. A mixed-state folder can appear in both sections; finished
tracks from it appear only in History. Pending folders open by default with 20
track names and a bounded Show more control. Waiting tracks have no sent-progress
bar or zero-sent counter. History includes successful, failed and cancelled
requests from the independent recent 500-record sample.

The header's tracks-left-to-send count covers the entire unfinished queue. Person
and folder counts cover the current queue page. The persistent queue footer labels
the page number, request range and 250-record limit; it is separate from History's
people-per-page control. Empty sections describe only the current queue page.

Person cancellation still applies to every matching unfinished request across all
pages. Block folder cancels and permanently denies that folder for that person;
its confirmation describes this existing behavior. Individual track actions affect
only the selected ID. Cancel requests on this page asks for confirmation and affects
only the displayed page's unfinished records, including collapsed folders. History
clearing retains its existing whole-history scope.

The web screen serializes refreshes, aborts obsolete requests when changing pages
or leaving, and pauses polling in hidden tabs. No new dependency or SQLite schema
change is required.

The global header uses `GET /api/v0/transfers/status` rather than downloading either
full queue. It reports active/queued counts per direction and ID/state/byte samples
for active transfers plus at most 500 completions in the last 15 seconds. Recent
completion samples preserve the final byte delta in throughput calculations.
SQLite uses the existing completion/time expression index to bound that lookup;
quiet periods do not scan the whole archive. Hidden tabs pause this poll too.

The Overview dashboard reuses the shell's byte samples for current throughput.
It does not poll transfer lists or start a second status poll. The header and
dashboard calculate speed from byte deltas, including a final completion sample,
rather than adding lifetime average speeds.

Browser performance boundaries:

- Process queues and analysis on the server; opening a page must not fetch a queue
  proportional to its entire backlog just to display totals.
- Fetch a bounded page for detailed rows; preserve totals and explicit navigation.
- Share small status samples, serialize polls, pause hidden tabs, and cancel
  obsolete requests so background UI refreshes cannot pile up.
- Start audio from the user's playback request independently of transfer refreshes
  and analysis completion. Verify actual player latency as well as API timings.

Read-only measurement against the live SQLite database on 31 October 2026:
42,836 records produced 18,673,322 JSON bytes (4,584,038 gzip bytes); a 250-record
pending page plus 500 recent completions produced 469,942 JSON bytes (134,308 gzip
bytes). The corresponding warm queries took 490 ms and 136 ms. The compact status
response was 323 bytes, queried in 56 ms. These are measurements of that snapshot,
not a guarantee of browser latency or zero impact under every load.

Network storage must not block the interface at startup or shutdown. Playlist
folder creation runs in the existing background rebuild, and music filesystem
watchers start on the background loop with the initial scan. Shutdown cancels
that work without starting a final scan. Completed analysis/tag changes already
persist their library rows; startup reconciliation discovers outstanding files.
An unavailable share can still prevent audio reads, but must not prevent the
HTTP listener from serving the indexed library and transfer summaries.

Metadata lookup history loads its saved skip records without probing every music
file during service construction. Missing-file pruning runs on the existing
background sweep task and supports cancellation; until then, prior attempts stay
protected from automatic re-enrichment. This was confirmed as a live startup
blocker with a managed stack trace before changing the implementation.

Media delivery resolves each requested file once and checks that canonical path
against freshly resolved configured roots. Stream and artwork handlers reuse the
authorized canonical result instead of walking network directories repeatedly.
Ordinary files/directories do not incur an unnecessary link-target lookup; actual
reparse points are still followed and checked. There is no cross-request path or
authorization cache, so link retargeting is checked again on every request.
