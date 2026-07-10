// <copyright file="browse.ts" company="John Narey">
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
import type { DirectoryFile } from './users';

export interface BrowseFolderSummary {
  name: string;
  fileCount: number;
  locked: boolean;
}

export interface BrowseStatus {
  percentComplete: number;
}

// The slim folder list: large shares serialize to tens of MB with full file
// detail (a 258k-file share is ~56 MB of JSON), which freezes the JS thread
// during parse. Folders-only is ~1-2 MB; files load per folder on expand.
// Fetching still transfers the whole share from the peer server-side, which
// can take well over the client's default 15s timeout.
export const browseFolders = (username: string): Promise<BrowseFolderSummary[]> =>
  apiClient
    .get<BrowseFolderSummary[]>(`/users/${encodeURIComponent(username)}/browse/folders`, {
      timeout: 180_000,
    })
    .then(r => (Array.isArray(r.data) ? r.data : []));

export const getFolderFiles = (username: string, directory: string): Promise<DirectoryFile[]> =>
  apiClient
    .post<{ name: string; files: DirectoryFile[] }[]>(
      `/users/${encodeURIComponent(username)}/directory`,
      { directory },
      { timeout: 60_000 },
    )
    .then(r => r.data?.[0]?.files ?? []);

export const getBrowseStatus = (username: string): Promise<BrowseStatus | null> =>
  apiClient
    .get<BrowseStatus>(`/users/${encodeURIComponent(username)}/browse/status`)
    .then(r => r.data)
    .catch(() => null);

export interface DownloadRequest {
  filename: string;
  size: number;
  destinationFolder?: string;
}

export const queueDownloads = (username: string, files: DownloadRequest[]): Promise<void> =>
  apiClient
    .post(`/transfers/downloads/${encodeURIComponent(username)}`, files)
    .then(() => undefined);

// ── Browse history (server-backed, broadcast over /hub/browse) ────────────────

export const getBrowseHistory = (): Promise<string[]> =>
  apiClient.get<string[]>('/browsehistory').then(r => (Array.isArray(r.data) ? r.data : []));

export const addToBrowseHistory = (username: string): Promise<string[]> =>
  apiClient
    .put<string[]>(`/browsehistory/${encodeURIComponent(username)}`)
    .then(r => (Array.isArray(r.data) ? r.data : []));

export const removeFromBrowseHistory = (username: string): Promise<string[]> =>
  apiClient
    .delete<string[]>(`/browsehistory/${encodeURIComponent(username)}`)
    .then(r => (Array.isArray(r.data) ? r.data : []));
