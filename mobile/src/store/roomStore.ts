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

import { dismissMessageAlerts } from '../services/messageAlerts';
import { prefetchMessagePreviews } from '../api/linkPreview';
import { onSessionReset, sessionGuard } from '../lib/sessionScope';
import { shallowEqual } from '../lib/shallowEqual';
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

const sameItems = <T extends object>(previous: T[], next: T[]): boolean =>
  previous.length === next.length && previous.every((item, index) => shallowEqual(item, next[index]));

function reconcileJoined(prev: Room[], next: Room[]): Room[] {
  const map = new Map(prev.map((r) => [r.name, r]));
  const result = next.map((r) => {
    const p = map.get(r.name);
    if (p === r) return p;
    const previousOperators = p?.operators ?? [];
    const operators = r.operators ?? [];
    if (p && p.isPrivate === r.isPrivate && p.owner === r.owner && p.operatorCount === r.operatorCount &&
        previousOperators.length === operators.length && previousOperators.every((name, index) => name === operators[index]) &&
        sameItems(p.users, r.users) && sameItems(p.messages, r.messages)) return p;
    return r;
  });
  return result.length === prev.length && result.every((r, i) => r === prev[i]) ? prev : result;
}

let listRequest = 0;
const messageRequests = new Map<string, number>();

interface RoomStore {
  joined: Room[];
  available: RoomInfo[];
  messages: Record<string, RoomMessage[]>;
  // Mention badges remain separate from ordinary room traffic.
  mentions: Record<string, number>;
  unread: Record<string, number>;
  readCounts: Record<string, number>;
  loadUnread: () => Promise<void>;
  markRead: (roomName: string) => void;
  isLoadingJoined: boolean;
  isLoadingAvailable: boolean;

  loadJoined: (quiet?: boolean) => Promise<void>;
  loadAvailable: () => Promise<void>;
  loadMessages: (roomName: string) => Promise<void>;
  join: (roomName: string) => Promise<void>;
  leave: (roomName: string) => Promise<void>;
  sendMessage: (roomName: string, text: string) => Promise<void>;
  noteMention: (roomName: string) => void;
  clearMentions: (roomName: string) => void;
}

export const totalRoomUnread = (s: RoomStore) =>
  Object.values(s.unread).reduce((n, v) => n + v, 0);

export const useRoomStore = create<RoomStore>((set, get) => ({
  joined: [],
  available: [],
  messages: {},
  mentions: {},
  unread: {},
  readCounts: {},
  loadUnread: async () => {
    const current = sessionGuard();
    const counts = await roomsAPI.getMessageCounts();
    if (!current()) return;
    set((s) => {
      const readCounts: Record<string, number> = {};
      const unread: Record<string, number> = {};
      for (const { room, count } of counts) {
        readCounts[room] = Math.min(s.readCounts[room] ?? count, count);
        unread[room] = count - readCounts[room];
      }
      return { readCounts, unread };
    });
  },
  markRead: (roomName) => {
    set((s) => ({
      readCounts: { ...s.readCounts, [roomName]: (s.readCounts[roomName] ?? 0) + (s.unread[roomName] ?? 0) },
      unread: { ...s.unread, [roomName]: 0 },
    }));
    void dismissMessageAlerts('room', roomName);
  },
  isLoadingJoined: false,
  isLoadingAvailable: false,

  loadJoined: async (quiet = false) => {
    const session = sessionGuard();
    const request = ++listRequest;
    const current = () => session() && request === listRequest;
    if (!quiet) set({ isLoadingJoined: true });
    try {
      const names  = await roomsAPI.getJoinedNames();
      if (!current()) return;
      const fresh  = await Promise.all(names.map((name) => {
        const cached = quiet ? get().joined.find((room) => room.name === name) : undefined;
        return cached ?? roomsAPI.getRoom(name);
      }));
      if (!current()) return;
      const joined = reconcileJoined(get().joined, fresh);
      for (const room of joined) prefetchMessagePreviews(room.messages);
      set((s) => ({ joined, isLoadingJoined: false,
        messages: Object.fromEntries(joined.map((room) => [room.name, s.messages[room.name] ?? room.messages])),
      }));
    } catch {
      if (!current()) return;
      set({ isLoadingJoined: false });
    }
  },

  loadAvailable: async () => {
    const current = sessionGuard();
    set({ isLoadingAvailable: true });
    try {
      const fresh     = await roomsAPI.getAvailable();
      if (!current()) return;
      const available = reconcileAvailable(get().available, fresh);
      set({ available, isLoadingAvailable: false });
    } catch {
      if (!current()) return;
      set({ isLoadingAvailable: false });
    }
  },

  loadMessages: async (roomName) => {
    const session = sessionGuard();
    const request = (messageRequests.get(roomName) ?? 0) + 1;
    messageRequests.set(roomName, request);
    const current = () => session() && messageRequests.get(roomName) === request;
    const messages = await roomsAPI.getMessages(roomName);
    if (!current()) return;
    prefetchMessagePreviews(messages);
    set((s) => {
      const previous = s.messages[roomName];
      if (previous && sameItems(previous, messages)) return s;
      return {
        messages: { ...s.messages, [roomName]: messages },
        joined: s.joined.map((room) => room.name === roomName ? { ...room, messages } : room),
      };
    });
  },

  join: async (roomName) => {
    const current = sessionGuard();
    await roomsAPI.join(roomName);
    if (!current()) return;
    await get().loadJoined();
  },

  leave: async (roomName) => {
    const current = sessionGuard();
    await roomsAPI.leave(roomName);
    if (!current()) return;
    messageRequests.set(roomName, (messageRequests.get(roomName) ?? 0) + 1);
    set((s) => ({
      joined: s.joined.filter((r) => r.name !== roomName),
      messages: Object.fromEntries(
        Object.entries(s.messages).filter(([k]) => k !== roomName)
      ),
      mentions: Object.fromEntries(
        Object.entries(s.mentions).filter(([k]) => k !== roomName)
      ),
    }));
  },

  sendMessage: async (roomName, text) => {
    const current = sessionGuard();
    await roomsAPI.sendMessage(roomName, text);
    if (!current()) return;
    await get().loadMessages(roomName);
  },

  noteMention: (roomName) =>
    set((s) => ({ mentions: { ...s.mentions, [roomName]: (s.mentions[roomName] ?? 0) + 1 } })),

  clearMentions: (roomName) =>
    set((s) => (s.mentions[roomName] ? { mentions: { ...s.mentions, [roomName]: 0 } } : s)),
}));

onSessionReset(() => {
  useRoomStore.setState(useRoomStore.getInitialState(), true);
});
