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
  ips?: string[];
  country?: string | null;
  city?: string | null;
}

export interface BlockedUserOptions {
  blockTransfers: boolean;
  blockBrowse: boolean;
  blockSearchResponses: boolean;
  blockPrivateMessages: boolean;
  hideRoomMessages: boolean;
  hideSearchResults: boolean;
  blockSameIp: boolean;
}

export interface BlockedIp {
  cidr: string;
  blockedAt: string;
  reason?: string | null;
}

export interface BlockedPlace {
  id: number;
  country: string;
  city?: string | null;
  blockedAt: string;
  reason?: string | null;
}

export interface BlockedUsersPayload {
  users: BlockedUser[];
  options: BlockedUserOptions;
  ips?: BlockedIp[];
  places?: BlockedPlace[];
  geoAvailable?: boolean;
}

export interface KnownLocations {
  countries: string[];
  citiesByCountry: Record<string, string[]>;
}

export const getBlockedUsers = (): Promise<BlockedUsersPayload> =>
  apiClient.get<BlockedUsersPayload>('/blockedusers').then(r => r.data);

// Distinct countries and (per country) cities observed from real peer connections
// via MaxMind — the source for the block-by-location dropdowns.
export const getKnownLocations = (): Promise<KnownLocations> =>
  apiClient.get<KnownLocations>('/blockedusers/geo').then(r => ({
    countries: r.data?.countries ?? [],
    citiesByCountry: r.data?.citiesByCountry ?? {},
  }));

export const blockUser = (username: string, reason?: string): Promise<BlockedUser[]> =>
  apiClient
    .put<BlockedUser[]>(`/blockedusers/${encodeURIComponent(username)}`, reason ? { reason } : {})
    .then(r => r.data);

export const unblockUser = (username: string): Promise<BlockedUser[]> =>
  apiClient
    .delete<BlockedUser[]>(`/blockedusers/${encodeURIComponent(username)}`)
    .then(r => r.data);

// Admin only. Clears the whole user list (and the IPs learned from it); IP and location rules stay.
export const unblockAllUsers = (): Promise<BlockedUser[]> =>
  apiClient.delete<BlockedUser[]>('/blockedusers').then(r => r.data);

export const setBlockedUserOptions = (options: BlockedUserOptions): Promise<BlockedUserOptions> =>
  apiClient.put<BlockedUserOptions>('/blockedusers/options', options).then(r => r.data);

export const blockIp = (cidr: string, reason?: string): Promise<BlockedIp[]> =>
  apiClient.post<BlockedIp[]>('/blockedusers/ips', { cidr, reason }).then(r => r.data);

export const unblockIp = (cidr: string): Promise<BlockedIp[]> =>
  apiClient
    .delete<BlockedIp[]>(`/blockedusers/ips?cidr=${encodeURIComponent(cidr)}`)
    .then(r => r.data);

export const blockPlace = (country: string, city?: string, reason?: string): Promise<BlockedPlace[]> =>
  apiClient
    .post<BlockedPlace[]>('/blockedusers/places', { country, city, reason })
    .then(r => r.data);

export const unblockPlace = (id: number): Promise<BlockedPlace[]> =>
  apiClient.delete<BlockedPlace[]>(`/blockedusers/places/${id}`).then(r => r.data);
