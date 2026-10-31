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
