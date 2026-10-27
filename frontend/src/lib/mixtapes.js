// <copyright file="mixtapes.js" company="John Narey">
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

const seedArtwork = (playlist) => {
  if (playlist)
    seedSignatures([
      {
        path: `playlist-artwork:${playlist.id}`,
        sig: playlist.artworkSig,
        exp: playlist.artworkExp,
      },
    ]);
  return playlist;
};

export const getAll = () =>
  api.get('/mixtapes').then((r) => r.data.map(seedArtwork));

export const create = ({ name, description }) =>
  api.post('/mixtapes', { name, description }).then((r) => r.data);

export const update = (id, { name, description }) =>
  api
    .put(`/mixtapes/${encodeURIComponent(id)}`, { name, description })
    .then((r) => r.data);

export const remove = (id) => api.delete(`/mixtapes/${encodeURIComponent(id)}`);

export const addTrack = (id, filePath) =>
  api
    .post(`/mixtapes/${encodeURIComponent(id)}/tracks`, { filePath })
    .then((r) => r.data);

export const removeTrack = (id, trackId) =>
  api.delete(
    `/mixtapes/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`,
  );

export const clearTracks = (id) =>
  api.delete(`/mixtapes/${encodeURIComponent(id)}/tracks`);

export const reorderTracks = (id, trackIds) =>
  api.put(`/mixtapes/${encodeURIComponent(id)}/tracks`, { trackIds });

export const publish = (id) =>
  api.post(`/mixtapes/${encodeURIComponent(id)}/publish`).then((r) => r.data);

export const unpublish = (id) =>
  api.delete(`/mixtapes/${encodeURIComponent(id)}/publish`);

// ── Public (no auth) ──────────────────────────────────────────────────────────

// Artwork is an uploaded image, often a multi-megabyte photo, so pass the pixel
// size it is shown at and the server sends a resized copy. version (the
// mixtape's updatedAt) busts the browser cache when the artwork is replaced.
const artworkQuery = ({ size, version } = {}) => {
  const parameters = new URLSearchParams();
  parameters.set(
    'size',
    Number.isFinite(size) && size > 0 ? Math.min(2_048, Math.ceil(size)) : 192,
  );
  if (version) parameters.set('v', version);
  const query = parameters.toString();
  return query ? `?${query}` : '';
};

export const artworkUrl = (id, options) =>
  `${apiBaseUrl}/mixtapes/${encodeURIComponent(id)}/artwork${artworkQuery(options)}${signedQuery(`playlist-artwork:${id}`)}`;

export const uploadArtwork = (id, file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/mixtapes/${encodeURIComponent(id)}/artwork`, form);
};

export const deleteArtwork = (id) =>
  api.delete(`/mixtapes/${encodeURIComponent(id)}/artwork`);

export const getPublic = (token) =>
  api.get(`/public/mixtapes/${encodeURIComponent(token)}`).then((r) => r.data);

export const downloadTrackUrl = (token, trackId) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/tracks/${encodeURIComponent(trackId)}/download`;

export const publicArtworkUrl = (token, options) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/artwork${artworkQuery(options)}`;

// ── M3U / zip exports ─────────────────────────────────────────────────────────

export const m3uUrl = (id) =>
  `${apiBaseUrl}/mixtapes/${encodeURIComponent(id)}/export.m3u`;

export const publicM3uUrl = (token) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/export.m3u`;

export const publicZipUrl = (token) =>
  `${apiBaseUrl}/public/mixtapes/${encodeURIComponent(token)}/download.zip`;
