// <copyright file="autoMix.js" company="John Narey">
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

import { harmonicNeighbours } from './camelot';

const shuffleArray = (array) => {
  const result = [...array];

  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));

    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
};

/**
 * Builds a harmonically compatible queue from a pool of keyed tracks.
 * @param {object} seed - { key, bpm, path } — the starting track
 * @param {object[]} pool - all keyed MusicTrack objects from the library
 * @param {object} [options]
 * @param {number} [options.bpmTolerance] - fraction tolerance for BPM matching (±8%)
 * @param {number} [options.count] - max queue length
 * @returns {object[]} ordered mix tracks
 */
export const buildAutoMix = (
  seed,
  pool,
  { bpmTolerance = 0.08, count = 30 } = {},
) => {
  if (!seed?.key || !pool?.length) return [];

  const compatibleKeys = harmonicNeighbours(seed.key);
  const candidates = pool.filter(
    (track) =>
      track.key && compatibleKeys.has(track.key) && track.path !== seed.path,
  );

  if (!candidates.length) return [];

  if (seed.bpm && seed.bpm > 0) {
    const bpmLow = seed.bpm * (1 - bpmTolerance);
    const bpmHigh = seed.bpm * (1 + bpmTolerance);
    const withinBpm = candidates.filter(
      (track) => track.bpm && track.bpm >= bpmLow && track.bpm <= bpmHigh,
    );
    const outOfBpm = candidates.filter(
      (track) => !track.bpm || track.bpm < bpmLow || track.bpm > bpmHigh,
    );

    return [...shuffleArray(withinBpm), ...shuffleArray(outOfBpm)].slice(
      0,
      count,
    );
  }

  return shuffleArray(candidates).slice(0, count);
};
