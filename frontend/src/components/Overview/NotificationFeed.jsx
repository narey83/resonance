// <copyright file="NotificationFeed.jsx" company="John Narey">
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

import {
  categoryOf,
  formatNotification,
  iconFor,
  loadNotificationSettings,
  relativeTime,
  toneOf,
} from '../../lib/notificationTypes';
import { Bell } from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const FILTERS = ['All', 'Transfers', 'Messages', 'System'];
const FILTER_CATEGORY = {
  Messages: 'message',
  System: 'system',
  Transfers: 'transfer',
};

const EventIcon = ({ type }) => {
  const Icon = iconFor(type) ?? Bell;
  return (
    <Icon
      className={`event-icon ${toneOf(type) ?? ''}`}
      size={13}
      strokeWidth={1.75}
    />
  );
};

const parseData = (raw) => {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw ?? {};
  } catch {
    return {};
  }
};

const formatEvent = (event) =>
  formatNotification(event.type, parseData(event.data));

const NotificationFeed = ({ events }) => {
  const [filter, setFilter] = useState('All');
  const [dismissed, setDismissed] = useState(new Set());
  const settings = loadNotificationSettings();

  const list = Array.isArray(events) ? events : [];

  const visible = list.filter((item) => {
    if (dismissed.has(item.id)) return false;
    if (settings[item.type] === false) return false;
    const category = FILTER_CATEGORY[filter];
    if (category) return categoryOf(item.type) === category;
    return true;
  });

  const dismiss = (id) =>
    setDismissed((previous) => new Set([...previous, id]));

  return (
    <div className="notif-feed">
      <div className="notif-header">
        <span className="notif-title">
          <Bell
            size={13}
            strokeWidth={1.75}
          />
          Activity
        </span>
        <select
          className="notif-filter"
          onChange={({ target }) => setFilter(target.value)}
          value={filter}
        >
          {FILTERS.map((filterOption) => (
            <option key={filterOption}>{filterOption}</option>
          ))}
        </select>
      </div>

      <div className="notif-list">
        {visible.length === 0 ? (
          <div className="notif-empty">No recent activity</div>
        ) : (
          visible.slice(0, 50).map((event) => {
            const { link, sub, text } = formatEvent(event);
            return (
              <div
                className="notif-item"
                key={event.id}
              >
                <div className="notif-icon-col">
                  <EventIcon type={event.type} />
                </div>
                <div className="notif-body">
                  {link ? (
                    <Link
                      className="notif-text-link"
                      to={link}
                    >
                      <div className="notif-text">{text}</div>
                    </Link>
                  ) : (
                    <div className="notif-text">{text}</div>
                  )}
                  {sub && <div className="notif-sub">{sub}</div>}
                </div>
                <div className="notif-time">
                  {relativeTime(event.timestamp)}
                </div>
                <button
                  className="notif-dismiss"
                  onClick={() => dismiss(event.id)}
                  title="Dismiss"
                  type="button"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default NotificationFeed;
