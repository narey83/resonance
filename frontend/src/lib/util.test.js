// <copyright file="util.test.js" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import * as utils from './util';

describe('formatBytesAsUnit', () => {
  it('converts bytes to specified unit', () => {
    expect(utils.formatBytesAsUnit(1_234_567, 'MB', 2)).toBe(1.18);
  });
});

describe('formatBitrate', () => {
  it('formats sub-Mbps speeds as Kbps', () => {
    expect(utils.formatBitrate(50_000)).toBe('400 Kbps');
  });

  it('formats mid-range speeds as Mbps', () => {
    expect(utils.formatBitrate(1_250_000)).toBe('10 Mbps');
  });

  it('formats very fast speeds as Gbps', () => {
    expect(utils.formatBitrate(125_000_000)).toBe('1 Gbps');
  });

  it('returns 0 Kbps for zero or missing input', () => {
    expect(utils.formatBitrate(0)).toBe('0 Kbps');
    expect(utils.formatBitrate(undefined)).toBe('0 Kbps');
  });
});

describe('isRecentlyIndexed', () => {
  const epochTicks = 621_355_968_000_000_000n;
  const ticksAt = (milliseconds) =>
    (epochTicks + BigInt(milliseconds) * 10_000n).toString();
  const now = Date.UTC(2026, 9, 28, 12);

  it('marks library items indexed within the last seven days as new', () => {
    expect(utils.isRecentlyIndexed(ticksAt(now - 6 * 86_400_000), now)).toBe(
      true,
    );
  });

  it('does not mark old, missing, or future timestamps as new', () => {
    expect(utils.isRecentlyIndexed(ticksAt(now - 7 * 86_400_000), now)).toBe(
      false,
    );
    expect(utils.isRecentlyIndexed(0, now)).toBe(false);
    expect(utils.isRecentlyIndexed(ticksAt(now + 1), now)).toBe(false);
  });
});

describe('keepIfEqual', () => {
  // The whole point is reference identity: an equal-but-new value must come
  // back as the OLD reference, or the re-render it exists to prevent happens
  // anyway.
  it('returns the previous reference when the data is unchanged', () => {
    const previous = [{ filename: 'a.mp3', percent: 50 }];
    expect(
      utils.keepIfEqual(previous, [{ filename: 'a.mp3', percent: 50 }]),
    ).toBe(previous);
  });

  it('returns the next value when the data differs', () => {
    const next = [{ filename: 'a.mp3', percent: 51 }];
    expect(utils.keepIfEqual([{ filename: 'a.mp3', percent: 50 }], next)).toBe(
      next,
    );
  });
});
