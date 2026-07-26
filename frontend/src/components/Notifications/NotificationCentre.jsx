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
import {
  formatNotification,
  iconFor,
  NOTIFICATION_TYPES,
  relativeTime,
} from '../../lib/notificationTypes';
import { Bell, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

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
                    const Icon = iconFor(n.type) ?? Bell;
                    const { link, sub, text } = formatNotification(
                      n.type,
                      n.data,
                    );
                    const body = (
                      <div className="nc-item-body">
                        <span className="nc-item-message">{text}</span>
                        {sub && <span className="nc-item-sub">{sub}</span>}
                        <span className="nc-item-time">
                          {relativeTime(n.timestamp)}
                        </span>
                      </div>
                    );
                    return (
                      <div
                        className={`nc-item${n.read ? '' : ' unread'}`}
                        key={n.id}
                      >
                        <span className="nc-item-icon">
                          <Icon size={13} />
                        </span>
                        {link ? (
                          <Link
                            className="nc-item-link"
                            onClick={onClose}
                            to={link}
                          >
                            {body}
                          </Link>
                        ) : (
                          body
                        )}
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
