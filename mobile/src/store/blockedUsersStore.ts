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
  blockIp as apiBlockIp,
  unblockIp as apiUnblockIp,
  blockPlace as apiBlockPlace,
  unblockPlace as apiUnblockPlace,
} from '../api/blockedUsers';
import type {
  BlockedIp,
  BlockedPlace,
  BlockedUser,
  BlockedUserOptions,
  BlockedUsersPayload,
} from '../api/blockedUsers';

// Server-backed block lists, shared across web and mobile. The application hub
// (see notificationService) pushes the full lists + options on connect and
// after every mutation, so blocked state stays live app-wide.

interface BlockedUsersStore {
  users: BlockedUser[];
  ips: BlockedIp[];
  places: BlockedPlace[];
  options: BlockedUserOptions | null;
  geoAvailable: boolean;
  blockedSet: Set<string>;

  isBlocked: (username: string) => boolean;
  apply: (payload: BlockedUsersPayload) => void;
  fetch: () => Promise<void>;
  block: (username: string, reason?: string) => Promise<void>;
  unblock: (username: string) => Promise<void>;
  blockIp: (cidr: string, reason?: string) => Promise<void>;
  unblockIp: (cidr: string) => Promise<void>;
  blockPlace: (country: string, city?: string, reason?: string) => Promise<void>;
  unblockPlace: (id: number) => Promise<void>;
}

const toSet = (users: BlockedUser[]) =>
  new Set(users.map(u => u.username.toLowerCase()));

export const useBlockedUsersStore = create<BlockedUsersStore>((set, get) => ({
  users: [],
  ips: [],
  places: [],
  options: null,
  geoAvailable: false,
  blockedSet: new Set(),

  isBlocked: (username: string) =>
    Boolean(username) && get().blockedSet.has(username.toLowerCase()),

  apply: ({ options, users, ips, places, geoAvailable }: BlockedUsersPayload) =>
    set(state => ({
      blockedSet: toSet(users ?? []),
      geoAvailable: geoAvailable ?? state.geoAvailable,
      ips: ips ?? state.ips,
      options: options ?? state.options,
      places: places ?? state.places,
      users: users ?? [],
    })),

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

  blockIp: async (cidr: string, reason?: string) => {
    const ips = await apiBlockIp(cidr, reason);
    set({ ips });
  },

  unblockIp: async (cidr: string) => {
    const ips = await apiUnblockIp(cidr);
    set({ ips });
  },

  blockPlace: async (country: string, city?: string, reason?: string) => {
    const places = await apiBlockPlace(country, city, reason);
    set({ places });
  },

  unblockPlace: async (id: number) => {
    const places = await apiUnblockPlace(id);
    set({ places });
  },
}));
