// <copyright file="waveform.test.js" company="John Narey">
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

import { beatGridSeconds } from './waveform';

// 128bpm: 0.469s a beat. The scales below are what the player's seek bar
// actually works at — a 5 minute track across ~900px is 3 pixels a second.
const BEAT = 60 / 128;

describe('beatGridSeconds', () => {
  it('keeps a line per beat once there is room for one', () => {
    expect(beatGridSeconds(128, 60, 8)).toBeCloseTo(BEAT);
  });

  it('widens to bars, then phrases, rather than drawing a Moiré comb', () => {
    // 2.8px a beat, 11px a bar.
    expect(beatGridSeconds(128, 6, 8)).toBeCloseTo(BEAT * 4);
    // 1.4px a beat, 5.6px a bar, 22px a phrase — a whole track, unzoomed.
    expect(beatGridSeconds(128, 3, 8)).toBeCloseTo(BEAT * 16);
  });

  it('gives up when even a phrase would not be legible', () => {
    expect(beatGridSeconds(128, 0.5, 8)).toBe(0);
  });

  it('always returns a whole number of beats, to stay on the grid', () => {
    for (const pixelsPerSecond of [0.5, 1, 3, 6, 20, 60, 400]) {
      const beats = beatGridSeconds(128, pixelsPerSecond, 8) / BEAT;
      expect(beats).toBeCloseTo(Math.round(beats));
    }
  });

  it('draws nothing without a tempo', () => {
    expect(beatGridSeconds(undefined, 60, 8)).toBe(0);
    expect(beatGridSeconds(0, 60, 8)).toBe(0);
  });
});
