// <copyright file="libraryActivity.ts" company="John Narey">
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
import { seedSignatures } from './streamSignatures';

export interface PlayStat {
  path: string;
  playCount: number;
  lastPlayedAt: number | null;
}

export interface PlayRecord {
  id: string;
  path: string;
  playedAt: number;
  title: string;
  artist: string;
  folder: string;
  source: string;
  // Server-embedded signature for path (artwork in the history list) — seeds the signature cache.
  sig?: string | null;
  exp?: number | null;
}

export interface LibraryActivitySnapshot {
  lovedPaths: string[];
  playStats: PlayStat[];
}

export const getLoved = async (): Promise<string[]> =>
  (await apiClient.get('/musiclibrary/loved')).data;

export const loveTrack = async (path: string): Promise<void> =>
  apiClient.put('/musiclibrary/loved', { path });

export const unloveTrack = async (path: string): Promise<void> =>
  apiClient.delete('/musiclibrary/loved', { params: { path } });

export const clearAllLoved = async (): Promise<void> =>
  apiClient.delete('/musiclibrary/loved/all');

export const recordPlay = async (
  path: string,
  meta?: { title?: string | null; artist?: string | null; folder?: string | null; source?: string },
): Promise<PlayStat> =>
  (await apiClient.post('/musiclibrary/plays', { path, ...meta })).data;

export const getPlayHistory = async (limit = 100, offset = 0): Promise<PlayRecord[]> => {
  const data: PlayRecord[] = (await apiClient.get('/musiclibrary/plays', { params: { limit, offset } })).data;
  seedSignatures(data);
  return data;
};

export const deletePlay = async (id: string): Promise<void> =>
  apiClient.delete(`/musiclibrary/plays/${encodeURIComponent(id)}`);

export const clearHistory = async (): Promise<void> =>
  apiClient.delete('/musiclibrary/plays');

export const getPlayStats = async (paths?: string[]): Promise<PlayStat[]> =>
  (await apiClient.get('/musiclibrary/plays/stats', paths ? { params: { paths } } : {})).data;
