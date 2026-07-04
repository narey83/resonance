// <copyright file="camelot.js" company="John Narey">
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

const MAP = {
  // Major (B suffix)
  C: { code: '8B', num: 8 },
  G: { code: '9B', num: 9 },
  D: { code: '10B', num: 10 },
  A: { code: '11B', num: 11 },
  E: { code: '12B', num: 12 },
  B: { code: '1B', num: 1 },
  'F#': { code: '2B', num: 2 },
  Gb: { code: '2B', num: 2 },
  'C#': { code: '3B', num: 3 },
  Db: { code: '3B', num: 3 },
  'G#': { code: '4B', num: 4 },
  Ab: { code: '4B', num: 4 },
  'D#': { code: '5B', num: 5 },
  Eb: { code: '5B', num: 5 },
  'A#': { code: '6B', num: 6 },
  Bb: { code: '6B', num: 6 },
  F: { code: '7B', num: 7 },
  // Minor (A suffix)
  Am: { code: '8A', num: 8 },
  Em: { code: '9A', num: 9 },
  Bm: { code: '10A', num: 10 },
  'F#m': { code: '11A', num: 11 },
  Gbm: { code: '11A', num: 11 },
  'C#m': { code: '12A', num: 12 },
  Dbm: { code: '12A', num: 12 },
  'G#m': { code: '1A', num: 1 },
  Abm: { code: '1A', num: 1 },
  'D#m': { code: '2A', num: 2 },
  Ebm: { code: '2A', num: 2 },
  'A#m': { code: '3A', num: 3 },
  Bbm: { code: '3A', num: 3 },
  Fm: { code: '4A', num: 4 },
  Cm: { code: '5A', num: 5 },
  Gm: { code: '6A', num: 6 },
  Dm: { code: '7A', num: 7 },
};

// 24 canonical positions in wheel order (1A/1B … 12A/12B)
// standard is the canonical stored value for that Camelot slot
export const CAMELOT_KEYS = [
  { camelot: '1A', standard: 'G#m' },
  { camelot: '1B', standard: 'B' },
  { camelot: '2A', standard: 'D#m' },
  { camelot: '2B', standard: 'F#' },
  { camelot: '3A', standard: 'A#m' },
  { camelot: '3B', standard: 'C#' },
  { camelot: '4A', standard: 'Fm' },
  { camelot: '4B', standard: 'Ab' },
  { camelot: '5A', standard: 'Cm' },
  { camelot: '5B', standard: 'Eb' },
  { camelot: '6A', standard: 'Gm' },
  { camelot: '6B', standard: 'Bb' },
  { camelot: '7A', standard: 'Dm' },
  { camelot: '7B', standard: 'F' },
  { camelot: '8A', standard: 'Am' },
  { camelot: '8B', standard: 'C' },
  { camelot: '9A', standard: 'Em' },
  { camelot: '9B', standard: 'G' },
  { camelot: '10A', standard: 'Bm' },
  { camelot: '10B', standard: 'D' },
  { camelot: '11A', standard: 'F#m' },
  { camelot: '11B', standard: 'A' },
  { camelot: '12A', standard: 'C#m' },
  { camelot: '12B', standard: 'E' },
];

// standard key → Camelot code string, e.g. 'Am' → '8A'
export const toCamelot = (standardKey) =>
  standardKey ? MAP[standardKey]?.code ?? null : null;

// numeric sort weight for key column: 1A=0, 1B=1, 2A=2 … 12B=23, unknown=999
export const camelotSortWeight = (standardKey) => {
  const entry = MAP[standardKey];
  if (!entry) return 999;
  return entry.num * 2 + (entry.code.endsWith('A') ? 0 : 1);
};

// HSL colour derived from position on the 12-step wheel
export const camelotColour = (code) => {
  if (!code) return null;
  const wheelStep = Number.parseInt(code, 10);
  if (!wheelStep) return null;
  const hue = Math.round(((wheelStep - 1) / 12) * 360);
  return `hsl(${hue}, 70%, 55%)`;
};

// compatible neighbours on the wheel (same number A/B + ±1)
export const harmonicNeighbours = (standardKey) => {
  const entry = MAP[standardKey];
  if (!entry) return new Set();
  const { num, code } = entry;
  const mode = code.endsWith('A') ? 'A' : 'B';
  const opposite = mode === 'A' ? 'B' : 'A';
  const previous = num === 1 ? 12 : num - 1;
  const next = num === 12 ? 1 : num + 1;
  const candidates = new Set([
    `${num}${mode}`,
    `${num}${opposite}`,
    `${previous}${mode}`,
    `${next}${mode}`,
  ]);
  return new Set(
    Object.entries(MAP)
      .filter(([, v]) => candidates.has(v.code))
      .map(([k]) => k),
  );
};
