// <copyright file="chat.ts" company="John Narey">
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
  lastMessageTimestamp?: string | null;
  // Populated by the list endpoint only, so the conversation list can show a
  // preview without pulling every conversation's messages; null on the
  // single-conversation endpoint, which returns `messages` instead.
  lastMessage?: PrivateMessage | null;
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
