// <copyright file="accentHue.js" company="John Narey">
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

// Every library surface that needs an accent colour derives it the same way: a stable hue in
// 0-359 from whatever names the thing, rendered through one lightness/saturation. Previously
// four near-identical copies of this lived in ArtistsView (nameToHue), GenreView
// (getGenreHue/genreColor) and YearView (getYearHue/yearColor), two of them byte-identical.

// Genres get hand-picked hues where the name suggests one — the associations are the point,
// so this stays a lookup rather than a hash. Order matters: longer, more specific keys first,
// since the first substring match wins ("death metal" before "metal", "hip hop" before "hip").
const GENRE_HUES = [
  ['drum and bass', 195],
  ['drum n bass', 195],
  ['dnb', 195],
  ['hip hop', 45],
  ['hip-hop', 45],
  ['r&b', 285],
  ['rnb', 285],
  ['neo soul', 280],
  ['bossa nova', 35],
  ['new wave', 200],
  ['post punk', 10],
  ['post rock', 5],
  ['prog rock', 355],
  ['nu metal', 350],
  ['death metal', 0],
  ['black metal', 350],
  ['heavy metal', 355],
  ['metal', 0],
  ['punk', 10],
  ['grunge', 25],
  ['shoegaze', 220],
  ['indie', 195],
  ['alternative', 170],
  ['rock', 0],
  ['techno', 195],
  ['trance', 280],
  ['house', 265],
  ['ambient', 210],
  ['industrial', 215],
  ['experimental', 225],
  ['electronic', 185],
  ['synth', 200],
  ['edm', 190],
  ['bass', 205],
  ['rap', 40],
  ['trap', 30],
  ['grime', 35],
  ['hip', 45],
  ['jazz', 38],
  ['blues', 230],
  ['soul', 280],
  ['funk', 42],
  ['gospel', 50],
  ['classical', 220],
  ['orchestral', 225],
  ['opera', 230],
  ['baroque', 215],
  ['chamber', 200],
  ['disco', 330],
  ['dance', 300],
  ['pop', 320],
  ['country', 30],
  ['folk', 100],
  ['bluegrass', 110],
  ['reggae', 120],
  ['ska', 115],
  ['latin', 25],
  ['samba', 20],
  ['world', 130],
  ['afro', 40],
];

// Eras have recognisable colour associations, so decades are mapped deliberately too.
const DECADE_HUES = {
  194: 35, // 1940s — warm amber (big band)
  195: 30, // 1950s — golden (rock 'n' roll dawn)
  196: 270, // 1960s — psychedelic purple
  197: 25, // 1970s — funky burnt orange
  198: 320, // 1980s — neon magenta
  199: 150, // 1990s — grunge green
  200: 200, // 2000s — digital blue
  201: 170, // 2010s — teal
  202: 250, // 2020s — electric violet
};

// Fallback for anything with no meaning attached to its name — an artist, a folder, an
// unrecognised genre. Only needs to be stable and well spread, not meaningful.
const hashHue = (value) => {
  const text = String(value ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    // eslint-disable-next-line no-bitwise
    hash = text.codePointAt(index) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
};

export const nameHue = hashHue;

export const genreHue = (genre) => {
  const lower = (genre || '').toLowerCase();
  for (const [keyword, hue] of GENRE_HUES) {
    if (lower.includes(keyword)) return hue;
  }

  return hashHue(genre);
};

export const yearHue = (year) => {
  const decade = Math.floor((year || 2_000) / 10);
  return DECADE_HUES[decade] ?? (decade * 37) % 360;
};

// One rendering of a hue, so an accent looks the same wherever it came from.
export const hueColour = (hue) => `hsl(${hue} 65% 55%)`;
