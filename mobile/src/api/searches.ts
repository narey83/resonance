// <copyright file="searches.ts" company="John Narey">
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

export interface Search {
  id: string;
  searchText: string;
  startedAt: string;
  endedAt: string | null;
  lastSearchedAt: string | null;
  state: number;
  fileCount: number;
  lockedFileCount: number;
  responseCount: number;
  isComplete: boolean;
}

export interface SearchFile {
  filename: string;
  displayFilename?: string;
  size: number;
  code: number;
  extension: string;
  length: number | null;
  bitRate: number | null;
  bitDepth: number | null;
  sampleRate: number | null;
  isVariableBitRate: boolean | null;
  isLocked: boolean;
}

export interface SearchResponse {
  username: string;
  token: number;
  uploadSpeed: number;
  queueLength: number;
  fileCount: number;
  lockedFileCount: number;
  hasFreeUploadSlot: boolean;
  files: SearchFile[];
  lockedFiles: SearchFile[];
}

export const getAll = (): Promise<Search[]> =>
  apiClient.get<Search[]>('/searches').then(r => r.data);

export const create = (id: string, searchText: string): Promise<Search> =>
  apiClient.post<Search>('/searches', { id, searchText }).then(r => r.data);

export const stop = (id: string): Promise<void> =>
  apiClient.put(`/searches/${encodeURIComponent(id)}`).then(() => undefined);

export const remove = (id: string): Promise<void> =>
  apiClient.delete(`/searches/${encodeURIComponent(id)}`).then(() => undefined);

export const getStatus = (id: string): Promise<Search> =>
  apiClient.get<Search>(`/searches/${encodeURIComponent(id)}`).then(r => r.data);

export const getResponses = (id: string): Promise<SearchResponse[]> =>
  apiClient.get<SearchResponse[]>(`/searches/${encodeURIComponent(id)}/responses`).then(r => r.data);

export const restart = (id: string): Promise<void> =>
  apiClient.post(`/searches/${encodeURIComponent(id)}/restart`).then(() => undefined);

// Strips parenthetical/bracketed remix markers, e.g. "(DJ X Remix)" or "[Club Mix]"
export const stripRemixInfo = (title: string): string => {
  const cleaned = title
    .replaceAll(
      /\s*[([][^)\]]*?(?:remix|edit|mix|bootleg|vip|rework|re-?edit|dj\s)[^)\]]*[)\]]/giu,
      '',
    )
    .trim()
    .replaceAll(/[\s–-]+$/gu, '')
    .trim();
  return cleaned || title;
};

export const downloadFiles = (
  username: string,
  files: (SearchFile & { destinationFolder?: string })[],
): Promise<void> =>
  apiClient
    .post(`/transfers/downloads/${encodeURIComponent(username)}`, files)
    .then(() => undefined);
