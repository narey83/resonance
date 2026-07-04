// <copyright file="folderDedup.js" company="John Narey">
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

const BRACKET_CONTENT = /[([][^)\]]*[)\]]/g; // [FLAC], (1979), [CD Rip], etc.
const BARE_YEAR = /\b(?:19|20)\d{2}\b/g;
const SEPARATORS = /[._-]+/g;
const SPACES = /\s+/g;

// If the last path segment already has an "Artist - Album" style separator we use
// it alone; otherwise we prepend the parent segment (likely the Artist folder) so
// that "Artist/Album [FLAC]" and "Artist - Album (1979)" both normalise the same way.
const getRawAlbumText = (folderPath) => {
  const segments = folderPath.replaceAll('\\', '/').split('/').filter(Boolean);
  const last = segments.at(-1) ?? '';
  if (!last) return '';
  const hasArtistSeparator = / - |_-_/u.test(last);
  if (hasArtistSeparator) return last;
  const parent = segments.at(-2) ?? '';
  return parent ? `${parent} ${last}` : last;
};

export const normalizeFolder = (folderPath) => {
  const raw = getRawAlbumText(folderPath);
  if (!raw) return '';
  return raw
    .replaceAll(BRACKET_CONTENT, '')
    .replaceAll(BARE_YEAR, '')
    .replaceAll(SEPARATORS, ' ')
    .replaceAll(SPACES, ' ')
    .trim()
    .toLowerCase();
};

// Groups folder objects (each requiring .directory and .label strings, plus .bestSpeed and
// .hasFreeSlot booleans) by normalized folder name.
// Returns array of { normalizedName, displayName, folders, bestSpeed, hasFreeSlot }
// sorted by source count desc, then bestSpeed desc.
export const groupFoldersByName = (folderGroups) => {
  const map = new Map();

  for (const folder of folderGroups) {
    const key = normalizeFolder(folder.directory) || folder.directory;

    if (!map.has(key)) {
      map.set(key, {
        normalizedName: key,
        displayName: folder.label,
        folders: [],
        bestSpeed: 0,
        hasFreeSlot: false,
      });
    }

    const group = map.get(key);
    group.folders.push(folder);

    if (folder.bestSpeed > group.bestSpeed) {
      group.bestSpeed = folder.bestSpeed;
      group.displayName = folder.label;
    }

    if (folder.hasFreeSlot) group.hasFreeSlot = true;
  }

  return [...map.values()].sort((a, b) =>
    b.folders.length !== a.folders.length
      ? b.folders.length - a.folders.length
      : b.bestSpeed - a.bestSpeed,
  );
};
