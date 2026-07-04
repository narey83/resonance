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

import { apiClient } from './client';
import { useAuthStore } from '../store/auth';
import { seedSignatures } from './streamSignatures';

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
}

export const getMixtapeArtworkUrl = (id: string): string | null => {
  const { serverUrl, accessToken } = useAuthStore.getState();
  if (!serverUrl) return null;
  const token = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : '';
  return `${serverUrl}/api/v0/mixtapes/${encodeURIComponent(id)}/artwork${token}`;
};

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

export const getAll        = async (): Promise<Mixtape[]> => {
  const data = await apiClient.get<Mixtape[]>('/mixtapes').then(r => r.data);
  data.forEach(m => seedTracks(m.tracks));
  return data;
};
export const getById       = async (id: string): Promise<Mixtape> => {
  const data = await apiClient.get<Mixtape>(`/mixtapes/${encodeURIComponent(id)}`).then(r => r.data);
  seedTracks(data.tracks);
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
  const form = new FormData();
  const filename = uri.split('/').pop() ?? 'artwork.jpg';
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  form.append('file', { uri, name: filename, type } as any);
  await apiClient.post(`/mixtapes/${encodeURIComponent(id)}/artwork`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
