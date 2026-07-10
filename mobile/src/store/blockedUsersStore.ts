// <copyright file="blockedUsersStore.ts" company="John Narey">
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

import { create } from 'zustand';
import {
  blockUser as apiBlockUser,
  getBlockedUsers,
  unblockUser as apiUnblockUser,
} from '../api/blockedUsers';
import type { BlockedUser, BlockedUserOptions, BlockedUsersPayload } from '../api/blockedUsers';

// Server-backed blocked user list, shared across web and mobile. The
// application hub (see notificationService) pushes the full list + options on
// connect and after every mutation, so blocked state stays live app-wide.

interface BlockedUsersStore {
  users: BlockedUser[];
  options: BlockedUserOptions | null;
  blockedSet: Set<string>;

  isBlocked: (username: string) => boolean;
  apply: (payload: BlockedUsersPayload) => void;
  fetch: () => Promise<void>;
  block: (username: string, reason?: string) => Promise<void>;
  unblock: (username: string) => Promise<void>;
}

const toSet = (users: BlockedUser[]) =>
  new Set(users.map(u => u.username.toLowerCase()));

export const useBlockedUsersStore = create<BlockedUsersStore>((set, get) => ({
  users: [],
  options: null,
  blockedSet: new Set(),

  isBlocked: (username: string) =>
    Boolean(username) && get().blockedSet.has(username.toLowerCase()),

  apply: ({ options, users }: BlockedUsersPayload) =>
    set({ blockedSet: toSet(users ?? []), options, users: users ?? [] }),

  fetch: async () => {
    const payload = await getBlockedUsers();
    get().apply(payload);
  },

  block: async (username: string, reason?: string) => {
    const users = await apiBlockUser(username, reason);
    set({ blockedSet: toSet(users), users });
  },

  unblock: async (username: string) => {
    const users = await apiUnblockUser(username);
    set({ blockedSet: toSet(users), users });
  },
}));
