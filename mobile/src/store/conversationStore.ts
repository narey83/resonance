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

