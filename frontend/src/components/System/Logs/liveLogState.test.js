// <copyright file="liveLogState.test.js" company="John Narey">
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

import {
  buildRows,
  contextsOf,
  dedupeAgainstSeen,
  LIVE_MAX_ENTRIES,
  logKey,
  mergeContexts,
  mergeLiveEntries,
  orderPollResults,
  pollCursor,
} from './liveLogState';

const entry = (id, timestamp, overrides = {}) => ({
  id,
  timestamp,
  level: 'Information',
  context: 'Application',
  message: `m${id}`,
  ...overrides,
});

describe('mergeLiveEntries', () => {
  it('prepends fresh entries ahead of the existing live window', () => {
    const prev = [
      entry(2, '2026-08-23T00:00:02Z'),
      entry(1, '2026-08-23T00:00:01Z'),
    ];
    const fresh = [entry(3, '2026-08-23T00:00:03Z')];

    expect(mergeLiveEntries(prev, fresh).map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it('never exceeds the configured maximum', () => {
    const prev = Array.from({ length: 10 }, (_, i) =>
      entry(10 - i, `t${10 - i}`),
    );
    const fresh = [entry(11, 't11')];

    const merged = mergeLiveEntries(prev, fresh, 5);

    expect(merged).toHaveLength(5);
  });

  it('retains the newest entries and discards the oldest on overflow', () => {
    const prev = Array.from({ length: 10 }, (_, i) =>
      entry(10 - i, `t${10 - i}`),
    );
    const fresh = [entry(11, 't11')];

    const merged = mergeLiveEntries(prev, fresh, 5);

    // newest sent (11) through the 5th-newest (7) survive; 6 and below are dropped
    expect(merged.map((e) => e.id)).toEqual([11, 10, 9, 8, 7]);
  });

  it('defaults to LIVE_MAX_ENTRIES when no explicit cap is given', () => {
    const prev = Array.from({ length: LIVE_MAX_ENTRIES }, (_, i) =>
      entry(i, `t${i}`),
    );
    const fresh = [entry(LIVE_MAX_ENTRIES, `t${LIVE_MAX_ENTRIES}`)];

    expect(mergeLiveEntries(prev, fresh)).toHaveLength(LIVE_MAX_ENTRIES);
  });

  it('is a no-op when nothing new arrived', () => {
    const prev = [entry(1, 't1')];

    expect(mergeLiveEntries(prev, [])).toBe(prev);
  });
});

describe('dedupeAgainstSeen', () => {
  it('drops items whose key is already in the seen set, keeping the rest in order', () => {
    const seen = new Set([logKey(entry(1, 't1'))]);
    const items = [entry(1, 't1'), entry(2, 't2'), entry(3, 't3')];

    const fresh = dedupeAgainstSeen(items, seen);

    expect(fresh.map((e) => e.id)).toEqual([2, 3]);
  });

  it('never produces duplicates across repeated calls with the same seen set', () => {
    const seen = new Set();
    const first = dedupeAgainstSeen([entry(1, 't1'), entry(2, 't2')], seen);
    const second = dedupeAgainstSeen([entry(2, 't2'), entry(3, 't3')], seen);

    expect(first.map((e) => e.id)).toEqual([1, 2]);
    expect(second.map((e) => e.id)).toEqual([3]);
  });

  it('keys by id when present, falling back to the composite key otherwise', () => {
    const seen = new Set();
    dedupeAgainstSeen([entry(1, 't1')], seen);

    // a JSONL-backed record (no id) is never conflated with a same-shaped Postgres one
    const jsonlRecord = {
      timestamp: 't1',
      context: 'Application',
      level: 'Information',
      message: 'm1',
    };
    const fresh = dedupeAgainstSeen([jsonlRecord], seen);

    expect(fresh).toHaveLength(1);
  });
});

describe('pollCursor', () => {
  it('uses afterId when the newest entry has a real id', () => {
    expect(pollCursor(entry(42, 't'))).toEqual({ afterId: 42 });
  });

  it('falls back to the timestamp cursor when there is no id (JSONL-backed)', () => {
    const record = {
      timestamp: '2026-08-23T00:00:00Z',
      context: 'Application',
      level: 'Information',
      message: 'm',
    };

    expect(pollCursor(record)).toEqual({ from: '2026-08-23T00:00:00Z' });
  });

  it('returns an empty cursor when there is no newest entry yet', () => {
    expect(pollCursor(undefined)).toEqual({});
  });
});

describe('orderPollResults', () => {
  it('reverses ascending afterId results back to newest-first', () => {
    const items = [entry(1, 't1'), entry(2, 't2'), entry(3, 't3')];

    expect(orderPollResults(items, true).map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it('leaves from-cursor results (already newest-first) untouched', () => {
    const items = [entry(3, 't3'), entry(2, 't2'), entry(1, 't1')];

    expect(orderPollResults(items, false)).toBe(items);
  });
});

describe('buildRows', () => {
  it('inserts one date separator per distinct day, newest-first', () => {
    const entries = [
      entry(3, '2026-08-23T10:00:00Z'),
      entry(2, '2026-08-23T09:00:00Z'),
      entry(1, '2026-08-22T09:00:00Z'),
    ];

    const { rows } = buildRows(entries);

    expect(rows.map((r) => r.type)).toEqual([
      'date',
      'log',
      'log',
      'date',
      'log',
    ]);
    expect(rows[0].day).toBe('2026-08-23');
    expect(rows[3].day).toBe('2026-08-22');
  });

  it('does not repeat a separator for a day already opened by startDay', () => {
    // simulates a history page continuing the same day the live window ended on
    const { rows } = buildRows(
      [entry(1, '2026-08-23T01:00:00Z')],
      '2026-08-23',
    );

    expect(rows.map((r) => r.type)).toEqual(['log']);
  });

  it('opens a new separator when startDay differs from the first entry', () => {
    const { rows } = buildRows(
      [entry(1, '2026-08-22T23:00:00Z')],
      '2026-08-23',
    );

    expect(rows.map((r) => r.type)).toEqual(['date', 'log']);
    expect(rows[0].day).toBe('2026-08-22');
  });

  it('returns the day of the last processed entry for chaining into the next segment', () => {
    const { lastDay } = buildRows([
      entry(2, '2026-08-23T10:00:00Z'),
      entry(1, '2026-08-22T10:00:00Z'),
    ]);

    expect(lastDay).toBe('2026-08-22');
  });

  it('returns an empty result for an empty segment, preserving startDay', () => {
    expect(buildRows([], '2026-08-20')).toEqual({
      rows: [],
      lastDay: '2026-08-20',
    });
  });
});

describe('contextsOf / mergeContexts', () => {
  it('collects the distinct, non-empty context values from a segment', () => {
    const entries = [
      entry(1, 't1', { context: 'Application' }),
      entry(2, 't2', { context: 'Transfers / Uploads' }),
      entry(3, 't3', { context: 'Application' }),
      entry(4, 't4', { context: null }),
    ];

    expect(contextsOf(entries)).toEqual(
      new Set(['Application', 'Transfers / Uploads']),
    );
  });

  it('merges known contexts with any number of segment sets, sorted and deduped', () => {
    const merged = mergeContexts(
      ['Application', 'Music / Library'],
      new Set(['Transfers / Uploads']),
      new Set(['Application']), // duplicate of a known context
    );

    expect(merged).toEqual([
      'Application',
      'Music / Library',
      'Transfers / Uploads',
    ]);
  });

  it('contexts recomputed after a real trim reflect only what actually survived', () => {
    // Regression guard for the original bug: after enough polling that mergeLiveEntries has
    // actually evicted the oldest live entries (a real merge that crosses the cap, not just an
    // empty no-op poll), the context set derived from what's left must drop a context that only
    // ever appeared in the evicted entries -- and must not silently keep stale values around.
    const live = [entry(2, 't2', { context: 'Music / Library' })];
    const fresh = [entry(3, 't3', { context: 'Transfers / Uploads' })];

    const trimmed = mergeLiveEntries(live, fresh, 1); // caps at 1 -> evicts id 2

    expect(trimmed.map((e) => e.id)).toEqual([3]);
    expect(contextsOf(trimmed)).toEqual(new Set(['Transfers / Uploads']));
  });
});
