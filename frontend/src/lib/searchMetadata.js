// <copyright file="searchMetadata.js" company="John Narey">
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

import { getDirectoryName, getFileName } from './util';

// Best-effort heuristics for deriving music-shaped metadata (artist, title, year,
// extension) from raw Soulseek file paths, which carry no ID3 tags. All fields are
// allowed to be wrong or empty for shares that don't follow a
// .../Artist/Album (Year)/Track.ext-like layout.

const BARE_YEAR = /\b(?:19|20)\d{2}\b/u;

// e.g. "58. ", "01 - ", "4) " — a leading track number, not an artist.
const TRACK_NUMBER_PREFIX = /^\s*\d{1,3}\s*[.)-]\s*/u;

// Lazy match up to the FIRST " - " so "Artist - Title (Other Artist Remix - Extended)"
// splits on the artist/title boundary, not inside the parenthetical.
const ARTIST_TITLE_SEPARATOR = /^(.+?)\s-\s(.+)$/u;

const getBaseName = (filepath) => {
  const name = getFileName(filepath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

// Many Soulseek shares embed "Artist - Title" directly in the filename (common for
// flat compilation dumps with no per-artist folder), which is more reliable than any
// folder-position guess when present.
const splitArtistTitle = (baseName) => {
  const stripped = baseName.replace(TRACK_NUMBER_PREFIX, '');
  const match = stripped.match(ARTIST_TITLE_SEPARATOR);
  if (match) return { artist: match[1].trim(), title: match[2].trim() };
  return { artist: '', title: stripped.trim() };
};

export const getPathDepth = (filepath) => {
  const parts = filepath
    .replaceAll('\\', '/')
    .split('/')
    .filter((p) => p && !/^[A-Za-z]:$/u.test(p));
  return {
    artist: parts.length >= 3 ? parts[parts.length - 3] : '',
    album: parts.length >= 2 ? parts[parts.length - 2] : '',
  };
};

// Prefers the artist embedded in the filename itself; falls back to the
// 2-levels-up folder guess only when the filename has no "Artist - Title" shape.
export const getArtist = (filepath) => {
  const { artist } = splitArtistTitle(getBaseName(filepath));
  return artist || getPathDepth(filepath).artist;
};

export const getTitle = (filepath) =>
  splitArtistTitle(getBaseName(filepath)).title;

// A real extension is a short alphanumeric token. Some shares append a promo/watermark
// suffix after the real extension with no further dot (e.g. "Track.mp3@synoresource"),
// so strip anything from "@" onward before validating. Filenames with no real extension
// (e.g. an embedded release tag like "(06 MB)-(10F)-(TRANCE)-(2010)" after the last dot,
// or an artist credit that happens to contain a period) fail the alnum check and yield ''
// rather than polluting the extension list with garbage.
const VALID_EXTENSION = /^[a-z\d]{1,10}$/u;

export const getExtension = (filepath) => {
  const name = getFileName(filepath);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  const candidate = name
    .slice(dot + 1)
    .split('@')[0]
    .trim()
    .toLowerCase();
  return VALID_EXTENSION.test(candidate) ? candidate : '';
};

// Searches the directory path first (e.g. ".../Album (1994)/..."), then falls back
// to the filename itself (e.g. "Track (1994 Remaster).mp3"). Returns '' if neither
// contains a plausible year.
export const getYear = (filepath) => {
  const directoryMatch = getDirectoryName(filepath).match(BARE_YEAR);
  if (directoryMatch) return directoryMatch[0];
  const filenameMatch = getFileName(filepath).match(BARE_YEAR);
  return filenameMatch ? filenameMatch[0] : '';
};

export const extractMetadata = (filepath) => ({
  _artist: getArtist(filepath),
  _extension: getExtension(filepath),
  _title: getTitle(filepath),
  _year: getYear(filepath),
});

// AND semantics across whichever fields are non-empty; case-insensitive substring
// match for artist/title/folder, exact match for year (a 4-digit token, where
// substring matching would let "99" match both the 1990s and 2099-shaped strings).
export const matchesMetaFilters = (file, metaFilters) => {
  const { artist = '', folder = '', title = '', year = '' } = metaFilters;

  if (artist && !file._artist.toLowerCase().includes(artist.toLowerCase()))
    return false;
  if (title && !file._title.toLowerCase().includes(title.toLowerCase()))
    return false;
  if (folder && !file._directory.toLowerCase().includes(folder.toLowerCase()))
    return false;
  if (year && file._year !== year) return false;

  return true;
};
