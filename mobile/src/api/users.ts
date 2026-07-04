// <copyright file="users.ts" company="John Narey">
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

export interface DirectoryFile {
  filename: string;
  size: number;
  code: number;
  extension: string;
  length: number | null;
  bitRate: number | null;
  bitDepth: number | null;
  sampleRate: number | null;
  isVariableBitRate: boolean | null;
}

export interface Directory {
  name: string;
  files: DirectoryFile[];
}

export const getDirectoryContents = (username: string, directory: string): Promise<Directory[]> =>
  apiClient
    .post<Directory[]>(`/users/${encodeURIComponent(username)}/directory`, { directory })
    .then(r => r.data);

export type UserPresence = 'Online' | 'Away' | 'Offline';

export interface UserStatus {
  presence: UserPresence;
  isPrivileged: boolean;
}

export const getUserStatus = (username: string): Promise<UserStatus> =>
  apiClient.get<UserStatus>(`/users/${encodeURIComponent(username)}/status`).then(r => r.data);

export const getUserStatuses = (usernames: string[]): Promise<Record<string, UserStatus>> =>
  apiClient.post<Record<string, UserStatus>>('/users/statuses', usernames).then(r => r.data);
