// <copyright file="transfers.ts" company="John Narey">
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

export interface Transfer {
  id: string;
  username: string;
  direction: 'Download' | 'Upload';
  filename: string;
  size: number;
  state: string;
  stateDescription: string;
  requestedAt: string;
  enqueuedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  bytesTransferred: number;
  bytesRemaining: number;
  averageSpeed: number;
  percentComplete: number;
  placeInQueue: number | null;
  exception: string | null;
  attempts: number;
  nextAttemptAt: string | null;
}

interface DirectoryResponse {
  directory: string;
  fileCount: number;
  files: Transfer[];
}

interface UserResponse {
  username: string;
  peerAddress: string | null;
  directories: DirectoryResponse[];
}

export type TransferDir = 'download' | 'upload';

// The API returns UserResponse[] (grouped by user → directory → files).
// Flatten into a single Transfer[] for simpler consumption.
export const getAll = (dir: TransferDir): Promise<Transfer[]> =>
  apiClient
    .get<UserResponse[]>(`/transfers/${dir}s`)
    .then(r => r.data.flatMap(u => u.directories.flatMap(d => d.files)));

export const cancelTransfer = (dir: TransferDir, username: string, id: string, remove = false) =>
  apiClient.delete(
    `/transfers/${dir}s/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=${remove}`,
  );

export const clearCompleted = (dir: TransferDir) =>
  apiClient.delete(`/transfers/${dir}s/all/completed`);
