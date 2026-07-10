// <copyright file="blockedUsers.ts" company="John Narey">
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

export interface BlockedUser {
  username: string;
  blockedAt: string;
  reason?: string | null;
}

export interface BlockedUserOptions {
  blockTransfers: boolean;
  blockBrowse: boolean;
  blockSearchResponses: boolean;
  blockPrivateMessages: boolean;
  hideRoomMessages: boolean;
  hideSearchResults: boolean;
}

export interface BlockedUsersPayload {
  users: BlockedUser[];
  options: BlockedUserOptions;
}

export const getBlockedUsers = (): Promise<BlockedUsersPayload> =>
  apiClient.get<BlockedUsersPayload>('/blockedusers').then(r => r.data);

export const blockUser = (username: string, reason?: string): Promise<BlockedUser[]> =>
  apiClient
    .put<BlockedUser[]>(`/blockedusers/${encodeURIComponent(username)}`, reason ? { reason } : {})
    .then(r => r.data);

export const unblockUser = (username: string): Promise<BlockedUser[]> =>
  apiClient
    .delete<BlockedUser[]>(`/blockedusers/${encodeURIComponent(username)}`)
    .then(r => r.data);

export const setBlockedUserOptions = (options: BlockedUserOptions): Promise<BlockedUserOptions> =>
  apiClient.put<BlockedUserOptions>('/blockedusers/options', options).then(r => r.data);
