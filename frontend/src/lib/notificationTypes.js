// <copyright file="notificationTypes.js" company="John Narey">
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

// Single source of truth for every notification/event kind shown in the bell
// panel (NotificationCentre) and the Overview "Activity" feed. Keys match the
// backend's EventType enum (backend/Events/Types/Events.cs) so persisted
// event-log records and live hub pushes both format through the same table.

import { urlBase } from '../config';
import * as prefs from './prefs';
import { getFileName, parseUtcDate } from './util';
import {
  Download,
  FolderOpen,
  MessageCircle,
  MessageSquare,
  ShieldAlert,
  Upload,
  Zap,
  ZapOff,
} from 'lucide-react';

const truncate = (text, max = 60) => {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export const NOTIFICATION_TYPES = [
  ...[
    [
      'ActionSuccess',
      'Successful actions',
      'Confirmations when an action completes',
    ],
    ['ActionInfo', 'Information', 'Action updates and informational notices'],
    ['ActionWarning', 'Warnings', 'Actions that need attention'],
    ['ActionError', 'Errors', 'Failed actions and error details'],
    ['ServerStatus', 'Server status', 'Server restarts and recovery'],
  ].map(([key, label, description]) => ({
    key,
    label,
    description,
    Icon: ShieldAlert,
    category: 'system',
    defaultEnabled: true,
    format: (d) => ({ text: d.message || label, sub: '', link: null }),
  })),

  {
    key: 'PrivateMessageReceived',
    label: 'Private messages',
    description: 'Incoming private messages',
    Icon: MessageCircle,
    category: 'message',
    tone: 'message',
    defaultEnabled: true,
    format: (d) => ({
      text: d.message?.username ?? 'Message',
      sub: truncate(d.message?.message),
      link: `${urlBase}/chat`,
    }),
  },
  {
    key: 'RoomMention',
    label: 'Room mentions',
    description: 'When someone mentions you in a chat room',
    Icon: MessageSquare,
    category: 'message',
    tone: 'message',
    defaultEnabled: true,
    format: (d) => ({
      text: `${d.username ?? '?'} mentioned you in ${d.roomName ?? '?'}`,
      sub: truncate(d.message),
      link: `${urlBase}/rooms`,
    }),
  },
  {
    key: 'RoomMessageReceived',
    label: 'Room messages',
    description: 'New messages in rooms you have joined',
    Icon: MessageCircle,
    category: 'message',
    tone: 'message',
    defaultEnabled: true,
    format: (d) => ({
      text: `${d.message?.username ?? '?'} in ${d.message?.roomName ?? '?'}`,
      sub: truncate(d.message?.message),
      link: `${urlBase}/rooms`,
    }),
  },
  {
    key: 'Browsed',
    label: 'File browse',
    description: 'When someone browses your shared files',
    Icon: FolderOpen,
    category: 'system',
    defaultEnabled: true,
    format: (d) => ({
      text: `${d.username ?? '?'} browsed your files`,
      sub: '',
      link: null,
    }),
  },
  {
    key: 'DownloadDirectoryComplete',
    label: 'Download complete',
    description: 'When one of your downloads finishes',
    Icon: Download,
    category: 'transfer',
    tone: 'download',
    // Can be frequent on a busy server, so opt-in to avoid a flood.
    defaultEnabled: false,
    format: (d) => ({
      text: d.remoteDirectoryName ?? 'Directory complete',
      sub: d.username ? `from ${d.username}` : '',
      link: null,
    }),
  },
  {
    key: 'DownloadFileComplete',
    label: 'Download complete',
    description: 'When an individual file download finishes',
    Icon: Download,
    category: 'transfer',
    tone: 'download',
    defaultEnabled: false,
    format: (d) => ({
      text: getFileName(d.remoteFilename ?? '') || 'a file',
      sub: d.transfer?.username ? `from ${d.transfer.username}` : '',
      link: null,
    }),
  },
  {
    key: 'UploadFileComplete',
    label: 'Upload complete',
    description: 'When someone finishes downloading a file from you',
    Icon: Upload,
    category: 'transfer',
    tone: 'upload',
    defaultEnabled: false,
    format: (d) => ({
      text: getFileName(d.remoteFilename ?? '') || 'a file',
      sub: d.transfer?.username ? `to ${d.transfer.username}` : '',
      link: null,
    }),
  },
  {
    key: 'SoulseekClientConnected',
    label: 'Soulseek connected',
    description: 'When the Soulseek connection comes back up',
    Icon: Zap,
    category: 'system',
    tone: 'connected',
    defaultEnabled: true,
    format: () => ({ text: 'Connected to Soulseek', sub: '', link: null }),
  },
  {
    key: 'SoulseekClientDisconnected',
    label: 'Soulseek disconnected',
    description: 'When the Soulseek connection drops',
    Icon: ZapOff,
    category: 'system',
    tone: 'disconnected',
    defaultEnabled: true,
    format: (d) => ({
      text: 'Disconnected from Soulseek',
      sub: truncate(d.message, 60),
      link: null,
    }),
  },
  {
    key: 'UserBlocked',
    label: 'Blocked-user alerts',
    description: 'When a user is auto-blocked for ban evasion (same IP)',
    Icon: ShieldAlert,
    category: 'system',
    defaultEnabled: true,
    // Live-only: not part of the persisted event log.
    format: (d) => ({
      text: `${d.username ?? '?'} was auto-blocked`,
      sub: `same IP as a blocked user (${d.ip ?? '?'})`,
      link: null,
    }),
  },
];

export const NOTIFICATION_TYPE_MAP = Object.fromEntries(
  NOTIFICATION_TYPES.map((t) => [t.key, t]),
);

export const DEFAULT_NOTIFICATION_SETTINGS = Object.fromEntries(
  NOTIFICATION_TYPES.map((t) => [t.key, t.defaultEnabled]),
);

export const loadNotificationSettings = () => {
  const saved = prefs.get('resonance-notification-settings', null);
  if (saved && typeof saved === 'object')
    return { soundsEnabled: true, ...DEFAULT_NOTIFICATION_SETTINGS, ...saved };
  return { soundsEnabled: true, ...DEFAULT_NOTIFICATION_SETTINGS };
};

// Format a notification's { type, data } into display fields, tolerating
// unknown/future event types instead of throwing.
export const formatNotification = (type, data) => {
  const entry = NOTIFICATION_TYPE_MAP[type];
  if (!entry) return { text: type ?? 'Event', sub: '', link: null };
  return entry.format(data ?? {});
};

export const iconFor = (type) => NOTIFICATION_TYPE_MAP[type]?.Icon;

export const categoryOf = (type) => NOTIFICATION_TYPE_MAP[type]?.category;

export const toneOf = (type) => NOTIFICATION_TYPE_MAP[type]?.tone;

export const relativeTime = (date) => {
  const s = Math.floor((Date.now() - parseUtcDate(date)) / 1_000);
  if (s < 60) return 'just now';
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};
