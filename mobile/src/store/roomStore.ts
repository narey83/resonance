// <copyright file="roomStore.ts" company="John Narey">
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
import * as roomsAPI from '../api/rooms';
import type { Room, RoomInfo, RoomMessage } from '../api/rooms';

// Reuse existing object references when data hasn't changed so that React.memo
// in list rows can bail out instead of re-rendering on every loadAvailable call.
function reconcileAvailable(prev: RoomInfo[], next: RoomInfo[]): RoomInfo[] {
  const map = new Map(prev.map((r) => [r.name, r]));
  const result = next.map((r) => {
    const p = map.get(r.name);
    if (p && p.userCount === r.userCount && p.isPrivate === r.isPrivate &&
        p.isOwned === r.isOwned && p.isModerated === r.isModerated) return p;
    return r;
  });
  return result.length === prev.length && result.every((r, i) => r === prev[i]) ? prev : result;
}

function reconcileJoined(prev: Room[], next: Room[]): Room[] {
  const map = new Map(prev.map((r) => [r.name, r]));
  const result = next.map((r) => {
    const p = map.get(r.name);
    if (p && p.users.length === r.users.length && p.messages.length === r.messages.length) return p;
    return r;
  });
  return result.length === prev.length && result.every((r, i) => r === prev[i]) ? prev : result;
}

interface RoomStore {
  joined: Room[];
  available: RoomInfo[];
  messages: Record<string, RoomMessage[]>;
  isLoadingJoined: boolean;
  isLoadingAvailable: boolean;

  loadJoined: () => Promise<void>;
  loadAvailable: () => Promise<void>;
  loadMessages: (roomName: string) => Promise<void>;
  join: (roomName: string) => Promise<void>;
  leave: (roomName: string) => Promise<void>;
  sendMessage: (roomName: string, text: string) => Promise<void>;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  joined: [],
  available: [],
  messages: {},
  isLoadingJoined: false,
  isLoadingAvailable: false,

  loadJoined: async () => {
    set({ isLoadingJoined: true });
    try {
      const names  = await roomsAPI.getJoinedNames();
      const fresh  = await Promise.all(names.map((name) => roomsAPI.getRoom(name)));
      const joined = reconcileJoined(get().joined, fresh);
      set({ joined, isLoadingJoined: false });
    } catch {
      set({ isLoadingJoined: false });
    }
  },

  loadAvailable: async () => {
    set({ isLoadingAvailable: true });
    try {
      const fresh     = await roomsAPI.getAvailable();
      const available = reconcileAvailable(get().available, fresh);
      set({ available, isLoadingAvailable: false });
    } catch {
      set({ isLoadingAvailable: false });
    }
  },

  loadMessages: async (roomName) => {
    const messages = await roomsAPI.getMessages(roomName);
    set((s) => ({ messages: { ...s.messages, [roomName]: messages } }));
  },

  join: async (roomName) => {
    await roomsAPI.join(roomName);
    await get().loadJoined();
  },

  leave: async (roomName) => {
    await roomsAPI.leave(roomName);
    set((s) => ({
      joined: s.joined.filter((r) => r.name !== roomName),
      messages: Object.fromEntries(
        Object.entries(s.messages).filter(([k]) => k !== roomName)
      ),
    }));
  },

  sendMessage: async (roomName, text) => {
    await roomsAPI.sendMessage(roomName, text);
    await get().loadMessages(roomName);
  },
}));
