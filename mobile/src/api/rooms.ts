// <copyright file="rooms.ts" company="John Narey">
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

export interface RoomInfo {
  name: string;
  userCount: number;
  isPrivate: boolean;
  isOwned: boolean;
  isModerated: boolean;
}

export interface RoomUser {
  username: string;
  averageSpeed: number;
  countryCode: string | null;
  directoryCount: number;
  fileCount: number;
  slotsFree: boolean;
  status: number;
  uploadCount: number;
  self?: boolean;
}

export interface RoomMessage {
  roomName: string;
  username: string;
  message: string;
  timestamp: string;
  self?: boolean;
}

export interface Room {
  name: string;
  isPrivate: boolean;
  owner: string | null;
  operatorCount: number | null;
  operators: string[];
  users: RoomUser[];
  messages: RoomMessage[];
}

export const getAvailable = () =>
  apiClient.get<RoomInfo[]>('/rooms/available').then(r => r.data);

export const getJoinedNames = () =>
  apiClient.get<string[]>('/rooms/joined').then(r => r.data);

export const getRoom = (roomName: string) =>
  apiClient.get<Room>(`/rooms/joined/${encodeURIComponent(roomName)}`).then(r => r.data);

export const getMessages = (roomName: string) =>
  apiClient.get<RoomMessage[]>(`/rooms/joined/${encodeURIComponent(roomName)}/messages`).then(r => r.data);

export const join = (roomName: string) =>
  apiClient.post('/rooms/joined', JSON.stringify(roomName), {
    headers: { 'Content-Type': 'application/json' },
  });

export const leave = (roomName: string) =>
  apiClient.delete(`/rooms/joined/${encodeURIComponent(roomName)}`);

export const sendMessage = (roomName: string, message: string) =>
  apiClient.post(`/rooms/joined/${encodeURIComponent(roomName)}/messages`, JSON.stringify(message), {
    headers: { 'Content-Type': 'application/json' },
  });
