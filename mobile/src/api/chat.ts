import { apiClient } from './client';

export interface PrivateMessage {
  id: number;
  username: string;
  message: string;
  timestamp: string;
  direction: 'In' | 'Out';
  isAcknowledged: boolean;
  wasReplayed: boolean;
}

export interface Conversation {
  username: string;
  isActive: boolean;
  unAcknowledgedMessageCount: number;
  hasUnAcknowledgedMessages: boolean;
  messages?: PrivateMessage[];
}

export const getAll = (includeInactive = false) =>
  apiClient.get<Conversation[]>('/conversations', { params: { includeInactive } }).then(r => r.data);

export const getMessages = (username: string) =>
  apiClient.get<PrivateMessage[]>(`/conversations/${encodeURIComponent(username)}/messages`).then(r => r.data);

export const send = (username: string, message: string) =>
  apiClient.post(`/conversations/${encodeURIComponent(username)}`, JSON.stringify(message), {
    headers: { 'Content-Type': 'application/json' },
  });

export const acknowledge = (username: string) =>
  apiClient.put(`/conversations/${encodeURIComponent(username)}`);

export const remove = (username: string) =>
  apiClient.delete(`/conversations/${encodeURIComponent(username)}`);
