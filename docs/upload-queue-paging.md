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

User/folder counts on the pending table describe the displayed page. Their cancel
actions still apply to the whole matching user/folder queue, and confirmations say
so. Individual file actions apply only to the chosen ID. The toolbar's “Cancel
listed” action is limited to listed cancellable files.

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
