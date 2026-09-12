// <copyright file="musicLibrary.js" company="John Narey">
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

import { apiBaseUrl } from '../config';
import api from './api';
import { seedSignatures, signedQuery } from './streamSignatures';

// btoa only handles Latin-1; encode to UTF-8 bytes first so paths with non-ASCII chars work
const pathToBase64 = (s) => btoa(unescape(encodeURIComponent(s)));

// Paged list endpoints report the pre-window total in X-Total-Count. Falls back to the row
// count so an unpaged call (or a proxy that drops the header) still reports something sane.
const totalOf = (response, rows) =>
  Number(response.headers['x-total-count'] ?? rows.length) || rows.length;

export const getLibraryStats = async () =>
  (await api.get('/musiclibrary/stats')).data;

export const getSyncState = async () =>
  (await api.get('/musiclibrary/sync')).data;

export const triggerSync = async () => api.post('/musiclibrary/sync');

export const cancelSync = async () => api.post('/musiclibrary/sync/cancel');

export const getTracks = async (queryParameters) => {
  const data = (
    await api.get('/musiclibrary/tracks', { params: queryParameters })
  ).data;
  seedSignatures(data.tracks ?? []);
  return data;
};

// One window of tracks, shaped for usePagedList. `total` is the whole matching set, not the page.
export const getTrackPage = async (queryParameters) => {
  const data = await getTracks(queryParameters);
  return { items: data.tracks ?? [], total: data.total ?? 0 };
};

// Full track records for the user's loved paths only — resolved server-side against the library.
// Avoids downloading the entire library (20k+ tracks) just to show a handful of loved tracks.
export const getLovedTracks = async () => {
  const data = (await api.get('/musiclibrary/loved/tracks')).data ?? [];
  seedSignatures(data);
  return data;
};

export const getIssueTracks = async (issue, limit = 500_000) => {
  const data = (
    await api.get('/musiclibrary/tracks', { params: { [issue]: true, limit } })
  ).data;
  seedSignatures(data.tracks ?? []);
  return data;
};

// A React key for an album row. The server groups albums by (album, album_artist ?? directory), so
// one album whose tracks disagree about album_artist splits into two rows that share album, artist
// AND directory — identical keys, which React reports as duplicate children. albumArtist is what
// actually differs between those two rows (set on one, absent on the other), so it belongs in the key.
export const albumKey = (album) =>
  [
    album.album ?? '',
    album.artist ?? '',
    album.albumArtist ?? '',
    album.directory ?? '',
  ].join('|');

// Omit `limit` for the whole list; supply it for one window (see getAlbumPage).
export const getAlbums = async (artist, queryParameters = {}) => {
  const data = (
    await api.get('/musiclibrary/albums', {
      params: { ...(artist ? { artist } : {}), ...queryParameters },
    })
  ).data;
  seedSignatures(data, 'coverPath');
  return data;
};

export const getAlbumPage = async (queryParameters) => {
  const response = await api.get('/musiclibrary/albums', {
    params: queryParameters,
  });
  const items = response.data ?? [];
  seedSignatures(items, 'coverPath');
  return { items, total: totalOf(response, items) };
};

export const getArtists = async (queryParameters = {}) => {
  const data = (
    await api.get('/musiclibrary/artists', { params: queryParameters })
  ).data;
  seedSignatures(data, 'coverPath');
  return data;
};

export const getArtistPage = async (queryParameters) => {
  const response = await api.get('/musiclibrary/artists', {
    params: queryParameters,
  });
  const items = response.data ?? [];
  seedSignatures(items, 'coverPath');
  return { items, total: totalOf(response, items) };
};

export const getRecentlyAdded = async (limit = 20) => {
  const data = (
    await api.get('/musiclibrary/recentlyadded', { params: { limit } })
  ).data;
  seedSignatures(data, 'coverPath');
  return data;
};

export const getKeyedTracks = async () => {
  const data = (await api.get('/musiclibrary/keyed')).data;
  seedSignatures(data);
  return data;
};

export const getGenres = async () =>
  (await api.get('/musiclibrary/genres')).data;

// Per-metric coverage over the whole library, answered by one join. The analysis page's headline
// numbers; it used to derive them by counting a dump of every track.
export const getAnalysisStats = async () =>
  (await api.get('/musiclibrary/analysis-stats')).data;

// The distinct key values actually stored, for the analysis page's key filter (which matches a
// stored value exactly, so a fixed list of the 24 canonical spellings would miss the rest).
export const getKeys = async () => (await api.get('/musiclibrary/keys')).data;

export const getYears = async () => (await api.get('/musiclibrary/years')).data;

export const getFolders = async () => {
  const data = (await api.get('/musiclibrary/folders')).data;
  seedSignatures(data, 'coverPath');
  return data;
};

// Every metric comes from one decode, so these take a metrics flags string rather
// than per-metric booleans. Pass an array of paths to analyse a batch as ONE scan:
// a request per track would be rejected after the first, since there is one queue.
export const ALL_METRICS = 'Bpm, Key, Waveform, Loudness';

// skipAnalysed: ask for every metric and let the backend decode only the ones the
// track is still missing, rather than redoing key/BPM it already has.
export const analyzeTrack = async (
  paths,
  { metrics = ALL_METRICS, skipAnalysed = true } = {},
) =>
  api.post('/musiclibrary/tracks/analyze', {
    metrics,
    paths: Array.isArray(paths) ? paths : [paths],
    skipAnalysed,
  });

export const analyzeFolder = async (path, { metrics = ALL_METRICS } = {}) =>
  api.post('/musiclibrary/folders/analyze', { metrics, path });

export const deleteTrack = async (path) =>
  api.delete('/musiclibrary/tracks', { params: { path: pathToBase64(path) } });

export const deleteFolder = async (path) =>
  api.delete('/musiclibrary/folders', { params: { path: pathToBase64(path) } });

export const renameFolder = async (path, newName) =>
  api.patch('/musiclibrary/folders', { path, newName });

export const renameTrack = async (path, newFilename) =>
  api.patch('/musiclibrary/tracks', { path, newFilename });

export const deleteTrackBatch = async (maskedPaths) =>
  (await api.post('/musiclibrary/tracks/delete-batch', { maskedPaths })).data;

export const deleteTrackBatchLocal = async (paths) =>
  (
    await api.post('/musiclibrary/tracks/delete-batch-local', {
      paths: paths.map(pathToBase64),
    })
  ).data;

// Returns a URL for use in <img src={...}>, signed with the path's cached HMAC signature
// (see streamSignatures). The path must already be signed (the list fetchers warm the cache);
// an unsigned path yields a URL the server rejects with 401.
export const getArtworkUrl = (path, size = null) => {
  if (!path) return null;

  const sizeParameter = size ? `&size=${size}` : '';

  return `${apiBaseUrl}/musiclibrary/artwork?path=${encodeURIComponent(path)}${sizeParameter}${signedQuery(path)}`;
};
