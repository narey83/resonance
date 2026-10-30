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

import { prefetchMessagePreviews } from '../api/linkPreview';
import { shallowEqual } from '../lib/shallowEqual';
import { onSessionReset, sessionGuard } from '../lib/sessionScope';
import { create } from 'zustand';
import * as chatAPI from '../api/chat';
import type { Conversation, PrivateMessage } from '../api/chat';

let listRequest = 0;
const messageRequests = new Map<string, number>();

// Warm a few recent histories once per last-message revision, without acknowledging them.
const previewHistory = new Map<string, string>();
onSessionReset(() => previewHistory.clear());

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
    const session = sessionGuard();
    const request = ++listRequest;
    const current = () => session() && request === listRequest;
    set({ isLoading: true });
    try {
      const conversations = await chatAPI.getAll();
      if (!current()) return;
      prefetchMessagePreviews(conversations.flatMap(c => c.lastMessage ? [c.lastMessage] : []));
      const totalUnread = conversations.reduce((n, c) => n + c.unAcknowledgedMessageCount, 0);
      set({ conversations, totalUnread, isLoading: false });
      const recent = [...conversations].filter(c => c.username !== '..' && c.lastMessage).sort((a, b) =>
        Date.parse(b.lastMessageTimestamp ?? b.lastMessage!.timestamp) -
        Date.parse(a.lastMessageTimestamp ?? a.lastMessage!.timestamp)).slice(0, 4);
      for (const conversation of recent) {
        const signature = JSON.stringify(conversation.lastMessage);
        if (previewHistory.get(conversation.username) === signature) continue;
        if (previewHistory.size >= 128) previewHistory.delete(previewHistory.keys().next().value!);
        previewHistory.set(conversation.username, signature);
        void get().loadMessages(conversation.username).catch(() => {
          if (session() && previewHistory.get(conversation.username) === signature)
            previewHistory.delete(conversation.username);
        });
      }
    } catch {
      if (!current()) return;
      set({ isLoading: false });
    }
  },

  loadMessages: async (username) => {
    const session = sessionGuard();
    const request = (messageRequests.get(username) ?? 0) + 1;
    messageRequests.set(username, request);
    const current = () => session() && messageRequests.get(username) === request;
    const messages = await chatAPI.getMessages(username);
    if (!current()) return;
    prefetchMessagePreviews(messages);
    set((s) => {
      const prev = s.messages[username];
      return prev && prev.length === messages.length && prev.every((m, i) => shallowEqual(m, messages[i]))
        ? s : { messages: { ...s.messages, [username]: messages } };
    });
  },

  sendMessage: async (username, text) => {
    const current = sessionGuard();
    await chatAPI.send(username, text);
    if (!current()) return;
    await get().loadMessages(username);
    if (!current()) return;
    await get().loadConversations();
  },

  acknowledge: async (username) => {
    const current = sessionGuard();
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
      if (!current()) return;
    } catch {
      if (!current()) return;
      // Restore on failure
      await get().loadConversations();
      if (!current()) return;
    }
  },

  removeConversation: async (username) => {
    const current = sessionGuard();
    await chatAPI.remove(username);
    if (!current()) return;
    set((s) => ({
      conversations: s.conversations.filter((c) => c.username !== username),
    }));
    await get().loadConversations();
  },
}));

onSessionReset(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true);
});
