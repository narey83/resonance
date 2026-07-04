// <copyright file="conversationStore.ts" company="John Narey">
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
import * as chatAPI from '../api/chat';
import type { Conversation, PrivateMessage } from '../api/chat';

interface ConversationStore {
  conversations: Conversation[];
  messages: Record<string, PrivateMessage[]>;
  isLoading: boolean;
  totalUnread: number;

  loadConversations: () => Promise<void>;
  loadMessages: (username: string) => Promise<void>;
  sendMessage: (username: string, text: string) => Promise<void>;
  acknowledge: (username: string) => Promise<void>;
  removeConversation: (username: string) => Promise<void>;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  messages: {},
  isLoading: false,
  totalUnread: 0,

  loadConversations: async () => {
    set({ isLoading: true });
    try {
      const conversations = await chatAPI.getAll();
      const totalUnread = conversations.reduce((n, c) => n + c.unAcknowledgedMessageCount, 0);
      set({ conversations, totalUnread, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  loadMessages: async (username) => {
    const messages = await chatAPI.getMessages(username);
    set((s) => ({ messages: { ...s.messages, [username]: messages } }));
  },

  sendMessage: async (username, text) => {
    await chatAPI.send(username, text);
    await get().loadMessages(username);
    await get().loadConversations();
  },

  acknowledge: async (username) => {
    const prev = get().conversations.find((c) => c.username === username);
    const delta = prev?.unAcknowledgedMessageCount ?? 0;
    // Optimistically clear the badge before the API call
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.username === username
          ? { ...c, unAcknowledgedMessageCount: 0, hasUnAcknowledgedMessages: false }
          : c
      ),
      totalUnread: Math.max(0, s.totalUnread - delta),
    }));
    try {
      await chatAPI.acknowledge(username);
    } catch {
      // Restore on failure
      await get().loadConversations();
    }
  },

  removeConversation: async (username) => {
    await chatAPI.remove(username);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.username !== username),
    }));
    await get().loadConversations();
  },
}));

