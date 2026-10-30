# Upload peer connection cooldown

An upload peer that cannot establish connections can consume time on thousands of
files even when each individual file has failed only once. The upload service now
serializes attempts per peer before handing them to Soulseek.NET, so a pause also
covers files that were queued before the failures occurred. Other peers keep using
their own connections and the existing global/group upload limits.

Three consecutive connection-establishment failures within five minutes pause that
peer for five minutes. At expiry, one queued file probes the connection. A failed
probe opens another five-minute pause; a successful upload clears the failure
streak and resumes the backlog. Success on any file resets that peer's streak.

Connection-establishment failures retain the original transfer ID and queued
record, without an end time or terminal error. Failed files join the back of the
peer's waiting work. New requests and duplicate requests during a pause do not
bypass the gate. Waiting work does not hold global/group upload slots. Users may
still cancel queued files, and application shutdown cancels and drains waits.

Only SDK connection exceptions or timeouts before transfer progress count, including
wrapped exceptions. Offline parking, local filesystem errors, cancellation and
mixed application/network exception aggregates do not count. Failures after a
transfer has started retain the existing terminal-error handling. Late callbacks
from a failed SDK attempt cannot overwrite a queued retry or its eventual success.

The cooldown is process-local and requires no schema or API changes. Existing
startup recovery for interrupted transfers is unchanged; this does not introduce
queue persistence across application restarts.

Tests use a controlled clock and SDK stubs with the real upload queue and SQLite
records. They cover cross-file failures, expiry and probes, successful recovery,
peer isolation, slot release, new/duplicate requests, cancellation/shutdown,
lingering SDK entries, failure classification and stale callbacks.
