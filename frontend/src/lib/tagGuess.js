// <copyright file="tagGuess.js" company="John Narey">
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

const MIX_PATTERN =
  /\s(Original\sMix|Extended\sMix|Extended\sVersion|Club\sMix|Radio\sEdit|Radio\sMix|VIP\sMix|Dub\sMix|Album\sVersion|Single\sVersion|Instrumental)$/iu;

const normalizeMixType = (title) => {
  if (title.endsWith(')')) return title;
  const match = title.match(MIX_PATTERN);
  if (!match) return title;
  return `${title.slice(0, -match[0].length)} (${match[1]})`;
};

export const guessFromFilename = (filename, directory) => {
  const base = filename.replace(/\.[^.]+$/u, '');
  const directoryParts = directory ? directory.split('\\') : [];
  const albumGuess = directoryParts.at(-1) ?? '';
  const artistGuess = directoryParts.at(-2) ?? '';

  let title = base;
  let artist = artistGuess;

  // eslint-disable-next-line regexp/no-super-linear-backtracking
  const numbered = base.match(/^(\d+)[\s._-]+(.+)$/u);
  if (numbered) title = numbered[2].trim();

  if (title.includes(' - ')) {
    const [firstPart, ...rest] = title.split(' - ');
    artist = firstPart.trim();
    title = rest.join(' - ').trim();
  }

  return { album: albumGuess, artist, title: normalizeMixType(title) };
};
