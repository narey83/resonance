// <copyright file="dedup.js" company="John Narey">
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

const getBasename = (filename) => filename.replace(/.*[/\\]/u, '');

const getExtension = (filename) =>
  (filename.match(/\.([^.]+)$/u)?.[1] ?? '').toLowerCase();

const normalizeForDedup = (filename) =>
  getBasename(filename)
    .replace(/\.[^.]+$/u, '') // strip extension
    .replace(/_\d{15,}$/u, '') // strip legacy _<DateTime.Ticks> collision suffix
    .replace(/\s*\(\d+\)\s*$/u, '') // strip (1), (2) etc.
    .replace(/\s*[-_]\s*copy(?:\s*\(\d+\))?$/iu, '') // strip " - copy", "_copy (1)" etc.
    .replaceAll(/\s+/gu, ' ')
    .toLowerCase()
    .trim();

// Lossless beats lossy; then bitrate; then file size as tiebreaker
const qualityScore = (file) => {
  if (file.bitDepth) {
    return 1_000_000 + (file.bitRate || 0) + file.size / 1_000_000;
  }

  return (file.bitRate || 0) * 1_000 + file.size / 1_000_000;
};

const SIZE_TOLERANCE = 0.03; // 3%

const sizeDiffRatio = (a, b) =>
  Math.abs(a.size - b.size) / Math.max(a.size, b.size);

const isExactMatch = (a, b) =>
  a.size > 0 && a.size === b.size && a.length > 0 && a.length === b.length;

const isNameMatch = (a, b) =>
  normalizeForDedup(a.filename) === normalizeForDedup(b.filename);

const isFuzzyMatch = (a, b) =>
  a.length > 0 &&
  a.length === b.length &&
  a.size > 0 &&
  b.size > 0 &&
  getExtension(a.filename) === getExtension(b.filename) &&
  sizeDiffRatio(a, b) > 0 &&
  sizeDiffRatio(a, b) <= SIZE_TOLERANCE;

const nameMatchConfidence = (file, k) => {
  const withinTolerance =
    file.length > 0 &&
    file.length === k.length &&
    file.size > 0 &&
    k.size > 0 &&
    sizeDiffRatio(file, k) <= SIZE_TOLERANCE;

  return withinTolerance ? 'definite' : 'probable';
};

const findMatch = (file, kept) => {
  for (const [index, k] of kept.entries()) {
    if (isExactMatch(file, k)) return { index, confidence: 'definite' };

    if (isNameMatch(file, k)) {
      return { index, confidence: nameMatchConfidence(file, k) };
    }

    if (isFuzzyMatch(file, k)) return { index, confidence: 'probable' };
  }

  return null;
};

// Returns { kept, definite, probable }
// definite: certain duplicates (exact size+duration, or matching name with close size)
// probable: fuzzy matches (close size+duration, or matching name only)
export const findDuplicates = (files) => {
  const kept = [];
  const definite = [];
  const probable = [];

  for (const file of files) {
    const match = findMatch(file, kept);

    if (!match) {
      kept.push(file);
      continue;
    }

    // Keep the higher quality version
    const keepExisting = qualityScore(kept[match.index]) >= qualityScore(file);
    const loser = keepExisting ? file : kept[match.index];

    if (!keepExisting) kept[match.index] = file;

    if (match.confidence === 'definite') {
      definite.push(loser);
    } else {
      probable.push(loser);
    }
  }

  return { kept, definite, probable };
};
