# Upload queue and complete recipient lists

**User instruction, 2 November 2026:** every unfinished track going to the selected
person must be available in one scrollable list, with no Next page or Show more
controls. The recipient name and their existing user controls appear once in a
compact top bar. Change user selects another recipient; folders label the tracks
without adding more person headers. History remains on the existing History page.

The frontend automatically assembles the selected recipient's complete queue from
500-record transport pages, with at most two requests in flight. No partial list is
published: IDs are deduplicated, the final count and leading identities are checked,
and a moving queue is retried once. A failed reconciliation keeps the last complete
view with a retry notice. The UI virtualizes individual track rows, so all records
are scrollable without mounting thousands of DOM elements.

Unchanged membership is reused for up to 30 seconds while the leading sample
refreshes active progress. Changed counts, new sampled IDs or a previously active
ID missing from the sample force a complete reload. Periodic reconciliation catches
membership changes whose total stayed the same. Recipient changes and navigation
abort unfinished requests; hidden tabs pause polling. Only the selected recipient's
full files are loaded; other recipients still use compact aggregate counts.

Legacy API contracts remain available:

`GET /api/v0/transfers/uploads?page=0&pageSize=250` preserves the grouped response
shape and adds `X-Uploads-Total-Pending`. `page` is zero based. Page size must be
between 1 and 500; malformed or overflowing parameters return HTTP 400. Recent
completed history retains its independent 500-record cap. `activeOnly=true` omits
that history. Calls without `page` retain the existing unpaged contract for other
clients.

The header still distinguishes upload and download waiting counts. While Uploads is
open, its complete snapshot supplies the upload header count so it stays consistent
with the selected snapshot's recipient totals. Active transfers are separate.

`GET /api/v0/transfers/upload-queue?username=peer&page=0&pageSize=250` returns
`users` (username, pendingCount, activeCount, waitingCount), `username`, `page`,
`totalPending`, `userTotalPending` and grouped `transfers`. The recipient summary is
aggregated in the database without materializing every pending file. Unspecified
recipients default to the largest waiting queue. Removed and completed requests
are excluded, and an obsolete page clamps to the selected recipient's last page.
The endpoint returns no completed history and preserves the older upload APIs.

The top bar links separate upload/download waiting counts to their pages. While
Uploads is open, its full recipient summary supplies the top-bar upload count so
the page and header cannot disagree due to separate polling intervals. Leaving
the page returns the header to its normal compact-status source.

All pending tracks share one list, with their individual Waiting, Connecting or
Uploading status and live progress. Cancel all uploads cancels every unfinished
request for the selected recipient in one existing user-scoped operation. Individual
actions still affect only one ID. Block folder retains its existing cancellation
and permanent-denial confirmation. No upload/history records are modified by loading
or scrolling the complete list.

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
- Fetch transport pages with bounded concurrency for the selected recipient; render
  individual virtual rows for the complete list.
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
