// <copyright file="dedup.test.js" company="John Narey">
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

import { findDuplicates } from './dedup';

describe('findDuplicates', () => {
  it('treats a _<DateTime.Ticks> collision suffix as a duplicate of the clean-named track', () => {
    const clean = {
      filename: 'Adrian Lux - Teenage Crime (Nath Jennings Bootleg).mp3',
      size: 9_000_000,
      length: 240,
      bitRate: 320,
    };
    const tick = {
      filename:
        'Adrian Lux - Teenage Crime (Nath Jennings Bootleg)_639167203263122481.mp3',
      size: 8_900_000,
      length: 240,
      bitRate: 256,
    };

    const { kept, definite, probable } = findDuplicates([clean, tick]);

    // the higher-quality clean file is kept, the tick-suffixed one is flagged
    expect(kept).toEqual([clean]);
    expect([...definite, ...probable]).toEqual([tick]);
  });

  it('does not strip a short numeric suffix that is part of the real name', () => {
    const a = { filename: 'Some Mix_2024.mp3', size: 5_000_000, length: 180 };
    const b = { filename: 'Some Mix.mp3', size: 5_000_000, length: 180 };

    // identical size + length still makes these an exact match, so force them apart
    a.length = 181;

    const { kept } = findDuplicates([a, b]);

    // "_2024" is only 4 digits, so the names do not normalize to the same stem
    expect(kept).toEqual([a, b]);
  });
});
