// <copyright file="NotificationCentre.jsx" company="John Narey">
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

import './NotificationCentre.css';
import { parseUtcDate } from '../../lib/util';
import {
  Bell,
  FolderOpen,
  MessageCircle,
  MessageSquare,
  Trash2,
  X,
} from 'lucide-react';
import React, { useState } from 'react';

const NOTIFICATION_TYPES = [
  {
    key: 'privateMessage',
    label: 'Private messages',
    description: 'Incoming private messages',
    Icon: MessageCircle,
  },
  {
    key: 'browsed',
    label: 'File browse',
    description: 'When someone browses your shared files',
    Icon: FolderOpen,
  },
  {
    key: 'roomMention',
    label: 'Room mentions',
    description: 'When someone mentions you in a chat room',
    Icon: MessageSquare,
  },
];

const TYPE_ICON = Object.fromEntries(
  NOTIFICATION_TYPES.map(({ Icon, key }) => [key, Icon]),
);

const relativeTime = (date) => {
  const s = Math.floor((Date.now() - parseUtcDate(date)) / 1_000);
  if (s < 60) return 'just now';
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};

const NotificationCentre = ({
  notifications,
  onClear,
  onClose,
  onSettingsChange,
  settings,
}) => {
  const [tab, setTab] = useState('feed');

  return (
    <>
      <div
        className="nc-backdrop"
        onClick={onClose}
      />
      <div className="nc-panel">
        <div className="nc-header">
          <span className="nc-title">Notifications</span>
          <button
            className="nc-icon-btn hover-fx"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        <div className="nc-tabs">
          <button
            className={`nc-tab hover-fx${tab === 'feed' ? ' active' : ''}`}
            onClick={() => setTab('feed')}
            type="button"
          >
            Feed
          </button>
          <button
            className={`nc-tab hover-fx${tab === 'settings' ? ' active' : ''}`}
            onClick={() => setTab('settings')}
            type="button"
          >
            Settings
          </button>
        </div>

        {tab === 'feed' ? (
          <div className="nc-feed">
            {notifications.length === 0 ? (
              <div className="nc-empty">
                <Bell size={28} />
                <span>No notifications yet</span>
              </div>
            ) : (
              <>
                <div className="nc-list">
                  {notifications.map((n) => {
                    const Icon = TYPE_ICON[n.type] ?? Bell;
                    return (
                      <div
                        className={`nc-item${n.read ? '' : ' unread'}`}
                        key={n.id}
                      >
                        <span className="nc-item-icon">
                          <Icon size={13} />
                        </span>
                        <div className="nc-item-body">
                          <span className="nc-item-message">{n.message}</span>
                          <span className="nc-item-time">
                            {relativeTime(n.timestamp)}
                          </span>
                        </div>
                        {!n.read && <span className="nc-dot" />}
                      </div>
                    );
                  })}
                </div>
                <div className="nc-feed-footer">
                  <button
                    className="nc-clear-btn hover-fx"
                    onClick={onClear}
                    type="button"
                  >
                    <Trash2 size={12} />
                    Clear all
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="nc-settings">
            {NOTIFICATION_TYPES.map(({ Icon, description, key, label }) => (
              <div
                className="nc-setting-row"
                key={key}
              >
                <span className="nc-setting-icon">
                  <Icon size={13} />
                </span>
                <div className="nc-setting-body">
                  <span className="nc-setting-label">{label}</span>
                  <span className="nc-setting-desc">{description}</span>
                </div>
                <label className="nc-toggle">
                  <input
                    checked={settings[key] ?? true}
                    onChange={(e) => onSettingsChange(key, e.target.checked)}
                    type="checkbox"
                  />
                  <span className="nc-toggle-track" />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default NotificationCentre;
