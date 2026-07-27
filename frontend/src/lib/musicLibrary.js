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
import { ensureSigned, signedQuery } from './streamSignatures';

// btoa only handles Latin-1; encode to UTF-8 bytes first so paths with non-ASCII chars work
const pathToBase64 = (s) => btoa(unescape(encodeURIComponent(s)));

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
  await ensureSigned((data.tracks ?? []).map((t) => t.path));
  return data;
};

// Full track records for the user's loved paths only — resolved server-side against the library.
// Avoids downloading the entire library (20k+ tracks) just to show a handful of loved tracks.
export const getLovedTracks = async () => {
  const data = (await api.get('/musiclibrary/loved/tracks')).data ?? [];
  await ensureSigned(data.map((t) => t.path));
  return data;
};

export const getIssueTracks = async (issue, limit = 500_000) => {
  const data = (
    await api.get('/musiclibrary/tracks', { params: { [issue]: true, limit } })
  ).data;
  await ensureSigned((data.tracks ?? []).map((t) => t.path));
  return data;
};

export const getAlbums = async (artist) => {
  const data = (
    await api.get('/musiclibrary/albums', { params: artist ? { artist } : {} })
  ).data;
  await ensureSigned(data.map((a) => a.coverPath));
  return data;
};

export const getArtists = async () => {
  const data = (await api.get('/musiclibrary/artists')).data;
  await ensureSigned(data.map((a) => a.coverPath));
  return data;
};

export const getRecentlyAdded = async (limit = 20) => {
  const data = (
    await api.get('/musiclibrary/recentlyadded', { params: { limit } })
  ).data;
  await ensureSigned(data.map((a) => a.coverPath));
  return data;
};

export const getKeyedTracks = async () => {
  const data = (await api.get('/musiclibrary/keyed')).data;
  await ensureSigned(data.map((t) => t.path));
  return data;
};

export const getGenres = async () =>
  (await api.get('/musiclibrary/genres')).data;

export const getYears = async () => (await api.get('/musiclibrary/years')).data;

export const getFolders = async () => {
  const data = (await api.get('/musiclibrary/folders')).data;
  await ensureSigned(data.map((f) => f.coverPath));
  return data;
};

// Every metric comes from one decode, so these take a metrics flags string rather
// than per-metric booleans. Pass an array of paths to analyse a batch as ONE scan:
// a request per track would be rejected after the first, since there is one queue.
export const ALL_METRICS = 'Bpm, Key, Waveform, Loudness';
export const TAG_METRICS = 'Bpm, Key';

export const analyzeTrack = async (paths, { metrics = ALL_METRICS } = {}) =>
  api.post('/musiclibrary/tracks/analyze', {
    metrics,
    paths: Array.isArray(paths) ? paths : [paths],
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
