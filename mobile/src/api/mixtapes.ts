// <copyright file="mixtapes.ts" company="John Narey">
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

import { prepareImageUpload } from '../services/imageUpload';
import { apiClient } from './client';
import { useAuthStore } from '../store/auth';
import { seedSignatures, signedQuery } from './streamSignatures';

export interface MixtapeTrack {
  id: string;
  mixtapeId: string;
  filePath: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
  sortOrder: number;
  // Server-embedded signature for filePath (see streamSignatures) — seeds the signature cache.
  sig?: string | null;
  exp?: number | null;
}

export interface Mixtape {
  id: string;
  name: string;
  description: string | null;
  isPublished: boolean;
  publicToken: string | null;
  hasArtwork: boolean;
  createdAt: number;
  updatedAt: number;
  tracks: MixtapeTrack[];
  artworkSig?: string | null;
  artworkExp?: number;
}

// Mixtape artwork is an uploaded image, often a multi-megabyte photo, so pass the pixel size it
// is shown at (ARTWORK_THUMB_SIZE for rows, the tile's thumbSize for grids) and the server sends
// a resized copy.
export const getMixtapeArtworkUrl = (id: string, size?: number): string | null => {
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;
  const params = new URLSearchParams();
  params.set('size', String(Number.isFinite(size) && size! > 0 ? Math.min(2048, Math.ceil(size!)) : 192));
  const query = params.toString();
  return `${serverUrl}/api/v0/mixtapes/${encodeURIComponent(id)}/artwork?${query}${signedQuery(`playlist-artwork:${id}`)}`;
};

// expo-image cacheKey for a mixtape's artwork: per size, and per updatedAt so replacing the
// artwork isn't hidden behind the previous image in the disk cache.
export const getMixtapeArtworkCacheKey = (mixtape: Pick<Mixtape, 'id' | 'updatedAt'>, size: number): string =>
  `mixtape_${mixtape.id}_${mixtape.updatedAt}_${size}`;

export const getMixtapeM3uUrl = (id: string): string | null => {
  const { serverUrl, accessToken } = useAuthStore.getState();
  if (!serverUrl) return null;
  const token = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : '';
  return `${serverUrl}/api/v0/mixtapes/${encodeURIComponent(id)}/export.m3u${token}`;
};

export const getPublicM3uUrl = (publicToken: string): string | null => {
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;
  return `${serverUrl}/api/v0/public/mixtapes/${encodeURIComponent(publicToken)}/export.m3u`;
};

export const getPublicZipUrl = (publicToken: string): string | null => {
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;
  return `${serverUrl}/api/v0/public/mixtapes/${encodeURIComponent(publicToken)}/download.zip`;
};

// Mixtape tracks are signed by their filePath (used for both artwork and stream URLs).
const seedTracks = (tracks: MixtapeTrack[]) =>
  seedSignatures(tracks.map(t => ({ path: t.filePath, sig: t.sig, exp: t.exp })));

const seedArtwork = (m: Mixtape) => seedSignatures([{ path: `playlist-artwork:${m.id}`, sig: m.artworkSig, exp: m.artworkExp }]);

export const getAll        = async (): Promise<Mixtape[]> => {
  const data = await apiClient.get<Mixtape[]>('/mixtapes').then(r => r.data);
  data.forEach(m => { seedTracks(m.tracks); seedArtwork(m); });
  return data;
};
export const getById       = async (id: string): Promise<Mixtape> => {
  const data = await apiClient.get<Mixtape>(`/mixtapes/${encodeURIComponent(id)}`).then(r => r.data);
  seedTracks(data.tracks);
  seedArtwork(data);
  return data;
};
export const create        = (name: string, description?: string) => apiClient.post<Mixtape>('/mixtapes', { name, description }).then(r => r.data);
export const update        = (id: string, name: string, description?: string) => apiClient.put<Mixtape>(`/mixtapes/${encodeURIComponent(id)}`, { name, description }).then(r => r.data);
export const remove        = (id: string)                   => apiClient.delete(`/mixtapes/${encodeURIComponent(id)}`);
export const addTrack      = (id: string, filePath: string) => apiClient.post<MixtapeTrack>(`/mixtapes/${encodeURIComponent(id)}/tracks`, { filePath }).then(r => r.data);
export const removeTrack   = (id: string, trackId: string) => apiClient.delete(`/mixtapes/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`);
export const clearTracks   = (id: string)                   => apiClient.delete(`/mixtapes/${encodeURIComponent(id)}/tracks`);
export const reorderTracks = (id: string, trackIds: string[]) => apiClient.put(`/mixtapes/${encodeURIComponent(id)}/tracks`, { trackIds });
export const publish       = (id: string)                   => apiClient.post<Mixtape>(`/mixtapes/${encodeURIComponent(id)}/publish`).then(r => r.data);
export const unpublish     = (id: string)                   => apiClient.delete(`/mixtapes/${encodeURIComponent(id)}/publish`);

export const uploadArtwork = async (id: string, uri: string): Promise<void> => {
  const image = await prepareImageUpload(uri, 1024);
  try {
    const form = new FormData();
    form.append('file', { uri: image.uri, name: 'artwork.jpg', type: 'image/jpeg' } as any);
    await apiClient.post(`/mixtapes/${encodeURIComponent(id)}/artwork`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  } finally { image.dispose(); }
};
