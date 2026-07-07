// <copyright file="downloadDestination.js" company="John Narey">
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

import * as prefs from './prefs';
import { getPathDepth } from './searchMetadata';

const RECENT_FOLDERS_KEY = 'resonance-recent-dest-folders';

export const getRecentFolders = () => {
  const value = prefs.get(RECENT_FOLDERS_KEY, []);
  return Array.isArray(value) ? value : [];
};

export const saveRecentFolder = (folder) => {
  if (!folder?.trim()) return;
  const recent = [
    folder,
    ...getRecentFolders().filter((f) => f !== folder),
  ].slice(0, 10);
  prefs.set(RECENT_FOLDERS_KEY, recent);
};

// Guesses a sensible destination subfolder from a batch of share paths, e.g.
// "Artist/Album" when every selected file shares the same artist and album.
export const suggestDestinationFolder = (paths) => {
  if (paths.length === 0) return '';
  const parts = paths.map((p) => getPathDepth(p));
  const artists = new Set(parts.map((p) => p.artist).filter(Boolean));
  const albums = new Set(parts.map((p) => p.album).filter(Boolean));
  const album = albums.size === 1 ? [...albums][0] : '';
  const artist = artists.size === 1 ? [...artists][0] : '';
  if (artists.size > 1 && album) return `VA - Various Artists/${album}`;
  if (artist && album) return `${artist}/${album}`;
  if (artist) return artist;
  if (album) return album;
  return '';
};
