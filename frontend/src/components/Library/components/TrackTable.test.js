// <copyright file="TrackTable.test.js" company="John Narey">
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

import { COLUMNS, fitColumns } from './TrackTable';

// The table has no horizontal scroll, so any column still in the grid at a given width has to
// genuinely fit in it. These are the widths that matter: a wide desktop, a laptop pane, and a
// window narrow enough that most of the row has to go.
const ids = (width, widths = {}) =>
  fitColumns(
    COLUMNS.filter((c) => c.id !== 'added'),
    width,
    widths,
  ).map((c) => c.id);

// The same budget fitColumns works to: each column's floor, a 10px gap between them, and 48px of
// row padding. Spelled out here rather than imported so a change to either has to be deliberate.
const requiredFor = (columns) =>
  columns.reduce(
    (sum, c) =>
      sum + (c.def.endsWith('px') ? Number.parseInt(c.def, 10) : c.min),
    0,
  ) +
  10 * (columns.length - 1) +
  48;

describe('fitColumns', () => {
  it('keeps the whole row when there is room for it', () => {
    expect.assertions(1);
    expect(ids(1_600)).toEqual(
      COLUMNS.filter((c) => c.id !== 'added').map((c) => c.id),
    );
  });

  // The point of the whole exercise: a track listing that doesn't say what the track is (or show
  // its waveform) isn't one. These five survive every width, however little is left.
  it.each([1_600, 1_200, 900, 700, 500, 360, 240])(
    'still shows the name columns at %ipx',
    (width) => {
      expect.assertions(5);
      const kept = ids(width);
      expect(kept).toContain('title');
      expect(kept).toContain('artist');
      expect(kept).toContain('wave');
      expect(kept).toContain('num');
      expect(kept).toContain('love');
    },
  );

  it('drops columns in priority order as the table narrows', () => {
    expect.assertions(3);
    // Plays goes before quality — the waveform isn't in the drop order at all.
    expect(ids(900)).not.toContain('plays');
    expect(ids(900)).toContain('quality');
    expect(ids(870)).not.toContain('quality');
  });

  it('keeps tempo and analysis status ahead of loudness at narrow widths', () => {
    expect.assertions(3);
    expect(ids(600)).toContain('bpm');
    expect(ids(600)).not.toContain('lufs');
    expect(ids(550)).toContain('status');
  });

  // Widths at or above the point where there is still something left to give up. Narrower than
  // this only the undroppable columns remain, so the row is allowed to exceed the space.
  it.each([1_600, 1_200, 900, 700, 500])(
    'leaves nothing that overflows %ipx',
    (width) => {
      expect.assertions(1);
      const kept = fitColumns(
        COLUMNS.filter((c) => c.id !== 'added'),
        width,
        {},
      );
      expect(requiredFor(kept)).toBeLessThanOrEqual(width);
    },
  );

  it('never drops the waveform, even dragged wide enough to overflow', () => {
    expect.assertions(1);
    // Unlike a droppable column, a 600px waveform dragged this wide in a 900px table causes
    // overflow rather than getting removed — same treatment as title and artist.
    expect(ids(900, { wave: 600 })).toContain('wave');
  });
});
