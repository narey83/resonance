// <copyright file="importedAnalysis.test.js" company="John Narey">
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

import { importedGridWindow, importedVocalWindow } from './importedAnalysis';

describe('imported source timing', () => {
  it('preserves a final source beat beyond audio duration and includes the viewport endpoint', () => {
    expect.hasAssertions();
    const data = {
      contentCurrent: true,
      analysis: {
        durationSeconds: 1,
        beats: [
          { timeSeconds: 0.1, beatInBar: 1, bpm: 120 },
          { timeSeconds: 1.1, beatInBar: 2, bpm: 110 },
        ],
        downbeatsSeconds: [0.1],
      },
    };
    const grid = importedGridWindow(data, 0, 30);
    expect(grid.audioDuration).toBe(1);
    expect(grid.gridExtent).toBe(1.1);
    expect(grid.beats).toHaveLength(2);
    expect(grid.beats[1].timeSeconds).toBe(1.1);
    expect(grid.beats[1].x).toBe(1_000);
  });
  it('uses explicit downbeat timestamps rather than inferring a four-beat cycle', () => {
    expect.hasAssertions();
    const data = {
      contentCurrent: true,
      analysis: {
        durationSeconds: 10,
        beats: [
          { timeSeconds: 1, beatInBar: 1, bpm: 123 },
          { timeSeconds: 1.6, beatInBar: 2, bpm: 119 },
        ],
        downbeatsSeconds: [1.6],
      },
    };
    expect(
      importedGridWindow(data, 0, 10).beats.map((beat) => beat.downbeat),
    ).toEqual([false, true]);
  });
  it('does not invent a timeline from duration or BPM when source beats are absent', () => {
    expect.hasAssertions();
    expect(
      importedGridWindow(
        { contentCurrent: true, analysis: { durationSeconds: 10, bpm: 128 } },
        0,
        10,
      ),
    ).toBeNull();
  });
  it('does not invent a vocal timebase when its source step is absent', () => {
    expect.hasAssertions();
    expect(
      importedVocalWindow(
        { contentCurrent: true, analysis: { vocals: { levels: [1, 2, 3] } } },
        0,
        10,
      ),
    ).toEqual([]);
  });
});
