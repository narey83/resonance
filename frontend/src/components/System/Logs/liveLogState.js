// <copyright file="liveLogState.js" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

// Pure state-transition logic for the live log viewer, kept separate from index.jsx so it can be
// unit tested directly rather than only through the full virtualized component tree.
//
// The core problem this module fixes: the viewer used to hold one unbounded `entries` array, and
// every live-tail poll rebuilt two O(n) derived values (the rendered row list and the set of
// known contexts) over the *entire* accumulated session history -- cost that grew without bound
// the longer a tab stayed open, in an app that has demonstrated real bursts of hundreds of events
// and 666k+ events/day. The fix is a hard cap on the live window (see LIVE_MAX_ENTRIES) plus
// splitting "live" from "explicitly-scrolled-to history" so a poll only ever touches the bounded
// live segment -- never the history a user has scrolled back through.

import { parseUtcDate } from '../../../lib/util';

// Matches the mobile app's live-tail cap (MAX_LIVE), so the two log viewers behave consistently.
// TAIL_POLL_LIMIT (200) is the most a single poll can return; 500 leaves headroom for a poll that
// catches up on a full backlog (e.g. after the tab was hidden a while) without immediately
// evicting everything else. Large enough to browse "what just happened" without a fetch, small
// enough that processing it is trivial regardless of how long the session has been open --
// virtualization already makes DOM cost independent of this number, so it's sized purely for how
// cheap the *state* work should stay.
export const LIVE_MAX_ENTRIES = 500;

export const dayOf = (ts) => parseUtcDate(ts).toISOString().slice(0, 10);

// Prefers the real Postgres-backed id when present (cheap, guaranteed-unique) and falls back to
// the old composite key otherwise (JSONL-backed logging has no id on any record).
export const logKey = (log) =>
  log.id === undefined || log.id === null
    ? `${log.timestamp}|${log.context}|${log.level}|${log.message}`
    : `id:${log.id}`;

// The cursor for the *next* live-tail poll, given the newest entry currently loaded. Prefers the
// Postgres afterId fast path (a pure indexed seek: WHERE "Id" > @afterId) when the entry actually
// carries an id; falls back to the timestamp-based `from` cursor only when it doesn't. That's the
// one concrete compatibility case afterId can't cover -- JSONL-backed logging (Logger.Postgres
// disabled) never attaches an id to a record at all, so there's nothing to seek on.
export const pollCursor = (newestEntry) => {
  if (!newestEntry) return {};

  return newestEntry.id === undefined || newestEntry.id === null
    ? { from: newestEntry.timestamp }
    : { afterId: newestEntry.id };
};

// GET /logs?afterId=... returns ascending order (ORDER BY "Id", oldest-of-the-new first) --
// correct for the backend's own keyset-pagination contract, but the UI is newest-first
// throughout. The from-cursor path already returns newest-first, so only the afterId path needs
// reversing before it's merged in -- reversing unconditionally would silently flip that one.
export const orderPollResults = (items, usedAfterId) =>
  usedAfterId ? [...items].reverse() : items;

// Dedupes against a Set of already-seen keys, mutating it in place (the same tracking Set the
// caller reuses across every poll and page fetch), and returns only genuinely new items in their
// original relative order. Cost is O(items), never O(everything ever seen).
export const dedupeAgainstSeen = (items, seenKeys) => {
  const fresh = [];

  for (const item of items) {
    const key = logKey(item);

    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    fresh.push(item);
  }

  return fresh;
};

// Prepends newly-arrived, already newest-first-ordered, already-deduped live records and caps the
// result at `max`. Overflow is dropped, not moved anywhere -- if the user later scrolls back past
// where it was, fetchOlderPage re-fetches it fresh from Postgres, which still has the complete
// history regardless of what's evicted from this in-memory window. Cost is O(prevLive.length +
// freshOrdered.length), i.e. O(live window size), never O(total session history).
export const mergeLiveEntries = (
  prevLive,
  freshOrdered,
  max = LIVE_MAX_ENTRIES,
) => {
  if (freshOrdered.length === 0) return prevLive;

  const merged = [...freshOrdered, ...prevLive];

  return merged.length > max ? merged.slice(0, max) : merged;
};

// Rows (date separators + log rows) for one chronologically-ordered (newest-first) segment,
// continuing the running "day" from startDay so a segment appended after another -- a history
// page after the live window, or a later history page after an earlier one -- never emits a
// duplicate separator for a day the prior segment already opened. Returns the day of the
// segment's last entry so a caller building several segments in sequence (live, then each history
// page as it loads) can thread continuity through *without ever re-walking the earlier ones*.
// Cost is O(entries.length) -- the segment actually being built, never the segments before it.
export const buildRows = (entries, startDay = null) => {
  const rows = [];
  let lastDay = startDay;

  for (const log of entries) {
    const day = dayOf(log.timestamp);

    if (day !== lastDay) {
      rows.push({ day, type: 'date' });
      lastDay = day;
    }

    rows.push({ log, type: 'log' });
  }

  return { rows, lastDay };
};

// The distinct context values across one segment of entries. Building this per-segment (live,
// and each history page as it loads) rather than over everything every time is what keeps context
// tracking off the O(total entries) path entirely.
export const contextsOf = (entries) => {
  const set = new Set();

  for (const log of entries) {
    if (log.context) set.add(log.context);
  }

  return set;
};

// Every context the backend can emit (knownContexts, the static registry) plus whatever's
// actually been seen across the live window and any loaded history, deduped and sorted. Bounded
// by the number of *distinct* context values the app ever uses -- a small, fixed vocabulary --
// never by how many log entries or history pages are loaded. That's what makes it safe for this
// to still run on every poll: unlike entries, its cost doesn't grow with session length.
export const mergeContexts = (knownContexts, ...contextSets) => {
  const set = new Set(knownContexts);

  for (const contextSet of contextSets) {
    for (const context of contextSet) set.add(context);
  }

  return [...set].sort((a, b) => a.localeCompare(b));
};
