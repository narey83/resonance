# Upload peer connection cooldown

An upload peer that cannot establish connections can consume time on thousands of
files even when each individual file has failed only once. The upload service now
serializes attempts per peer before handing them to Soulseek.NET, so a pause also
covers files that were queued before the failures occurred. Other peers keep using
their own connections and the existing global/group upload limits.

Three connection-establishment failures or remote `Cancelled` rejections within
five minutes, without an intervening success, pause that peer for five minutes.
At expiry, one queued file probes the connection. A failed probe opens another five-minute pause; a successful upload clears the failure
streak and resumes the backlog. Success on any file resets that peer's streak.

Connection-establishment failures retain the original transfer ID and queued
record, without an end time or terminal error. Failed files join the back of the
peer's waiting work. New requests and duplicate requests during a pause do not
bypass the gate. Waiting work does not hold global/group upload slots. Users may
still cancel queued files, and application shutdown cancels and drains waits.

SDK connection exceptions or timeouts before transfer progress and remote
`Transfer rejected: Cancelled` rejections count, including wrapped exceptions.
Cancelled files remain terminal; the recipient’s remaining files stay queued.
Offline parking, local filesystem errors, local cancellation, other remote rejection
reasons (including `Complete`) and mixed application/network exception aggregates
do not count. Failures after a transfer has started retain the existing terminal-error handling. Late callbacks
from a failed SDK attempt cannot overwrite a queued retry or its eventual success.

The cooldown timer is process-local and requires no schema or API changes. The
pending upload queue survives a process restart in the existing transfers database.
Startup retains unfinished uploads under their original IDs and request metadata,
resets interrupted connection/transfer state to queued, and schedules them only
after Soulseek login and share-index readiness. A readiness event retries scheduling
if login happened while the index was still loading; the existing explicit
`no-share-scan` override remains supported. The peer negotiates any already-received file offset on the
next attempt. Clean queued rows need no recovery writes, even for a large backlog.
Completed history, removed files and explicit cancellations are never resurrected;
changes made after startup recovery are rechecked at login. If scheduling one peer
fails, its IDs remain available for the next login and other peers can resume.
Offline peers retain their files until they return or the user explicitly cancels;
the former automatic five-minute offline purge is removed.

## Queue-preserving deployment requirements

These are preparation requirements, not an instruction to deploy or restart now.

1. Build the new executable separately. Preserve the existing `--app-dir`, database,
   private settings and share cache; never replace them with publish-directory files.
2. Before stopping the old process, record the unfinished upload IDs, peer/file names,
   request times and counts. After it exits, reconcile those IDs against the final
   database: allow genuine completions and explicit user cancellation/removal, but
   abort if records disappeared or became shutdown-only failures. Refresh the
   retained-ID manifest. Abort if reconciliation fails. For the development instance,
   the user's 2 November instruction prohibits routine database backups unless
   explicitly requested; preserve existing backups and private state.
3. Start the new executable against that same application directory. Verify every
   captured pending ID still exists and is queued, active or legitimately completed;
   check Soulseek login and readiness. Files explicitly cancelled/removed during
   the transition must remain cancelled/removed. Do not equate a smaller queue with
   lost records: completed uploads are expected to leave the pending count.
4. Do not automatically start an older binary against this queue on rollback. The
   old startup routine marks unfinished uploads as `Application shut down`. Any
   rollback must use a build with this recovery fix, or a separately reviewed
   recovery plan using the verified backup before the old binary is allowed to run.

Already-terminal failures from earlier restarts are intentionally left as history;
this change preserves the current unfinished queue and does not replay old failures.

Tests use a controlled clock and SDK stubs with the real upload queue and SQLite
records. They cover cross-file failures, expiry and probes, successful recovery,
peer isolation, slot release, new/duplicate requests, cancellation/shutdown,
lingering SDK entries, failure classification and stale callbacks. File-backed
restart tests cover a 4,250-file legacy backlog, interrupted/cancelled recovery,
recovery idempotence, resumed completion under the same IDs, offline peers,
terminal/removed records, malformed terminal flags, cancellation between recovery
and login, and login/share-readiness ordering.


## Live cancellation cooldown verification — 4 November 2026

Backend `96e337f` was deployed to the dev laptop at 19:22 GMT. All 37,440
pending upload identities and request metadata survived graceful shutdown and
recovery, with no shutdown failures. Analysis was already idle; automatic
preparation stayed paused. The gateway and frontend services were preserved.
No database backup or schema change was performed.

The upload pause banner now covers repeated transfer failures, including remote
cancellations. It was delivered through the existing frontend hot reload service.
Authenticated desktop, 390px auto-size and 390px manual-100% browser checks passed:
the recipient's pause and retry time were visible, waiting files remained present,
folder expansion worked, and no page errors occurred. Screenshots were inspected.

Verification passed: 218 transfer/security tests, 17 upload component tests,
11 frontend dependency-security tests, ESLint/formatting, staged Release/StyleCop,
and the NuGet dependency audit. The configured real BPM/key detector preflight
passed, all 419 native artifact hashes matched after startup, and direct, public
and frontend-monitor readiness passed. The existing optional FFmpeg download-helper
diagnostic and 14 frontend dependency source-map warnings remain.

B_Side naturally cancelled three different files, triggering a pause at 19:22:58
GMT with 8,820 files still queued. No further attempt occurred for 301.691 seconds.
Exactly one probe then ran; its cancellation immediately opened another pause at
19:28:03 GMT until 19:33:03 GMT, preserving the remaining 8,819 queued files. Four
uploads to other recipients succeeded during this observation.

Private queue manifests, activation results, browser screenshots and live cooldown
observations are retained under
`/home/narey/resonance-builds/upload-cancellations-20261104/`.
