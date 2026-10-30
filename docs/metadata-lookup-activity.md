# Online lookup activity

Open **Tags → Online lookup** to see the live automatic-lookup setting, configured available providers, current pass and track activity. The setting controls automatic enrichment; the editor can still preview an online match while automatic lookup is disabled. Run controls require automatic lookup and an available provider.

Activity covers currently shared audio tracks. Search by filename or folder, filter the counts, and expand a track to inspect its latest 20 events. Pages contain at most 100 tracks (50 by default). A confirmed update remains visible when a later lookup finds no match or makes no changes.

- **Updated online:** at least one provider-supplied field differed from the actual pre-write file tags and was read back with the expected value after the write succeeded. Changed field names and their supplying providers are recorded.
- **Unchanged:** a match was found, but no changed online fields were confirmed. Existing tags are preserved during automatic enrichment.
- **No match / Failed:** the lookup found no confident match, or lookup/writing/verification failed. Neither outcome proves an update.
- **Not saved:** the editor returned a preview. Saving the draft carries a server-issued candidate identifier, bound to that track and valid for two hours. Only changed fields that still equal that candidate's values can receive online attribution; user modifications are excluded. Invalid or expired identifiers return HTTP 400 and require a new lookup.
- **Earlier attempt · unverified:** the old attempt cache contains this track, but it has no verified history. Even a legacy `written` outcome is not evidence of changed fields.
- **No lookup recorded:** no lookup evidence is available. Existing tags alone do not establish their origin.

`GET /api/v0/metadatalookup/activity` accepts `page` (1–1,000,000), `pageSize` (1–100), `search` (up to 250 characters), and `outcome` (`all`, `updated`, `notupdated`, `unknown`). It uses the same authentication policy as the tags UI and exposes share identities, not physical storage paths. `Updated`, `NotUpdated`, and `Unknown` are disjoint track counts across the current audio share; search and outcome filters affect `Filtered` and `Items`.

Evidence is appended to `data/metadata-lookup-activity.jsonl` inside the application data directory. Keep this file with persistent application state and backups, alongside `metadata-lookup-attempts.json`. The journal retains all recorded events on disk; the service holds the latest 20 per track plus its last confirmed update in memory. There is no automatic journal rotation. Paths use the same music-root-relative identities as lookup attempts. File moves to different relative paths establish new identities.

The old attempt cache continues to control automatic retries. Failed writes remain retryable; a full re-scan bypasses prior attempts. History is independent of pass progress and survives restarts. Interrupted records are skipped without discarding intact records, and loading/persistence failures produce an explicit incomplete-history warning. A lookup cancelled before a terminal outcome creates no successful-update record. Candidate identifiers expire on a server restart, so refresh an unsaved online preview before saving.
