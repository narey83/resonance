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
import { urlBase } from '../../config';
import {
  categoryOf,
  formatNotification,
  iconFor,
  NOTIFICATION_TYPE_MAP,
  NOTIFICATION_TYPES,
  relativeTime,
} from '../../lib/notificationTypes';
import { parseUtcDate } from '../../lib/util';
import {
  ArrowDownUp,
  ArrowUpRight,
  Bell,
  CheckCheck,
  Inbox,
  MessageCircle,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const categories = [
  { key: 'all', label: 'All activity', Icon: Inbox },
  { key: 'message', label: 'Messages', Icon: MessageCircle },
  { key: 'transfer', label: 'Transfers', Icon: ArrowDownUp },
  { key: 'system', label: 'System', Icon: Shield },
];
const dayOf = (timestamp, now) => {
  const date = parseUtcDate(timestamp) || new Date(Number.NaN);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return 'Today';
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? 'Yesterday' : 'Earlier';
};

const actionFor = (type, link, data) => {
  if (type === 'PrivateMessageReceived') {
    const username = data?.message?.username || data?.username;
    return {
      link: username ? `${link}?user=${encodeURIComponent(username)}` : link,
      label: 'Open conversation',
    };
  }

  if (type === 'RoomMention' || type === 'RoomMessageReceived')
    return { link, label: 'Open rooms' };
  if ((type || '').startsWith('Download'))
    return { link: `${urlBase}/downloads`, label: 'View downloads' };
  if ((type || '').startsWith('Upload'))
    return { link: `${urlBase}/uploads`, label: 'View uploads' };
  return link ? { link, label: 'View details' } : null;
};

const NotificationCentre = ({
  notifications,
  onClear,
  onClose,
  onMarkAllRead,
  onSettingsChange,
  settings,
}) => {
  const [tab, setTab] = useState('feed');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [now, setNow] = useState(Date.now);
  const panel = useRef(null);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = panel.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current.querySelector('button')?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }

      if (event.key !== 'Tab') return;
      const buttons = [
        ...panel.current.querySelectorAll(
          'button:not(:disabled), a[href], input',
        ),
      ].filter((el) => !el.hidden);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !panel.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !panel.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', keyboard);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      document.removeEventListener('keydown', keyboard);
      clearInterval(timer);
      document.body.style.overflow = overflow;
      const returnTarget =
        previous?.isConnected &&
        previous !== document.body &&
        !dialog.contains(previous)
          ? previous
          : document.querySelector('.app-nav button[title="Notifications"]');
      returnTarget?.focus();
    };
  }, [onClose]);

  const filtered = notifications
    .filter((n) => {
      const { sub, text } = formatNotification(n.type, n.data);
      return (
        (category === 'all' || (categoryOf(n.type) || 'system') === category) &&
        (!unreadOnly || !n.read) &&
        `${text} ${sub} ${NOTIFICATION_TYPE_MAP[n.type]?.label || n.type}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      );
    })
    .sort((a, b) => parseUtcDate(b.timestamp) - parseUtcDate(a.timestamp));
  const groups = ['Today', 'Yesterday', 'Earlier'].map((label) => ({
    label,
    items: filtered.filter((n) => dayOf(n.timestamp, now) === label),
  }));

  return (
    <>
      <button
        aria-hidden="true"
        className="nc-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-labelledby="nc-title"
        aria-modal="true"
        className="nc-panel dj-workspace"
        ref={panel}
        role="dialog"
      >
        <header className="nc-header">
          <div className="nc-heading">
            <span className="nc-eyebrow">
              <span /> YOUR ACTIVITY
            </span>
            <h2 id="nc-title">
              Notification centre<span className="nc-heading-dot">.</span>
            </h2>
            <p>Messages, milestones and what needs your attention.</p>
          </div>
          <button
            aria-label="Close notifications"
            className="nc-icon-btn"
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </header>
        <nav
          aria-label="Notification views"
          className="nc-tabs"
        >
          <button
            aria-pressed={tab === 'feed'}
            className={tab === 'feed' ? 'active' : ''}
            onClick={() => setTab('feed')}
            type="button"
          >
            <Bell size={16} /> Activity <span>{notifications.length}</span>
          </button>
          <button
            aria-pressed={tab === 'settings'}
            className={tab === 'settings' ? 'active' : ''}
            onClick={() => setTab('settings')}
            type="button"
          >
            <Settings2 size={16} /> Preferences
          </button>
        </nav>
        {tab === 'feed' ? (
          <>
            <div className="nc-controls">
              <div className="nc-summary">
                <div>
                  <strong>
                    {unread ? `${unread} unread` : 'You’re up to date'}{' '}
                  </strong>
                  <span>
                    {unread
                      ? 'A few things to catch up on.'
                      : 'Your recent activity lives here.'}
                  </span>
                </div>
                <button
                  className="nc-text-btn"
                  disabled={!unread}
                  onClick={onMarkAllRead}
                  type="button"
                >
                  <CheckCheck size={16} /> Mark all read
                </button>
              </div>
              <label className="nc-search">
                <Search size={17} />
                <input
                  aria-label="Search notifications"
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find something in your activity…"
                  value={query}
                />
                {query && (
                  <button
                    aria-label="Clear notification search"
                    onClick={() => setQuery('')}
                    type="button"
                  >
                    <X size={15} />
                  </button>
                )}
              </label>
              <div
                aria-label="Activity category"
                className="nc-categories"
              >
                {categories.map(({ Icon, key, label }) => (
                  <button
                    aria-pressed={category === key}
                    className={category === key ? 'active' : ''}
                    key={key}
                    onClick={() => setCategory(key)}
                    type="button"
                  >
                    <Icon size={15} />
                    {label}
                    <span>
                      {key === 'all'
                        ? notifications.length
                        : notifications.filter(
                            (n) => (categoryOf(n.type) || 'system') === key,
                          ).length}
                    </span>
                  </button>
                ))}
              </div>
              <div className="nc-filter-line">
                <span>
                  {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
                </span>
                <label>
                  <input
                    checked={unreadOnly}
                    onChange={(e) => setUnreadOnly(e.target.checked)}
                    type="checkbox"
                  />{' '}
                  Unread only
                </label>
              </div>
            </div>
            <div className="nc-feed">
              {!filtered.length ? (
                <div className="nc-empty">
                  <span className="nc-empty-icon">
                    <Inbox size={30} />
                  </span>
                  <h3>
                    {query || category !== 'all'
                      ? 'Nothing here just yet'
                      : unreadOnly
                        ? 'All caught up'
                        : 'A little quiet, for now'}
                  </h3>
                  <p>
                    {query
                      ? 'Try a different name or search term.'
                      : unreadOnly
                        ? 'You’ve read all the activity in this view.'
                        : 'New messages, transfer updates and server activity will appear here.'}
                  </p>
                  {(query || category !== 'all' || unreadOnly) && (
                    <button
                      className="nc-text-btn"
                      onClick={() => {
                        setQuery('');
                        setCategory('all');
                        setUnreadOnly(false);
                      }}
                      type="button"
                    >
                      Show all activity <ArrowUpRight size={16} />
                    </button>
                  )}
                </div>
              ) : (
                groups
                  .filter((g) => g.items.length)
                  .map(({ items, label }) => (
                    <section
                      aria-label={label}
                      className="nc-day"
                      key={label}
                    >
                      <h3>
                        {label}
                        <span>{items.length}</span>
                      </h3>
                      <ul>
                        {items.map((n) => {
                          const Icon = iconFor(n.type) || Bell;
                          const { link, sub, text } = formatNotification(
                            n.type,
                            n.data,
                          );
                          const action = actionFor(n.type, link, n.data);
                          const type = NOTIFICATION_TYPE_MAP[n.type];
                          const date =
                            parseUtcDate(n.timestamp) || new Date(Number.NaN);
                          const validDate = Number.isFinite(date.getTime());
                          return (
                            <li
                              className={`nc-item${n.read ? '' : ' unread'}${n.type === 'SoulseekClientDisconnected' || n.type === 'UserBlocked' ? ' nc-attention' : ''}`}
                              key={n.id}
                            >
                              <span
                                className={`nc-item-icon nc-kind-${type?.category || 'system'}`}
                              >
                                <Icon size={19} />
                              </span>
                              <div className="nc-item-body">
                                <div className="nc-item-meta">
                                  <span>
                                    {type?.label || 'System activity'}
                                  </span>
                                  <time
                                    dateTime={
                                      validDate ? date.toISOString() : undefined
                                    }
                                    title={
                                      validDate
                                        ? date.toLocaleString()
                                        : undefined
                                    }
                                  >
                                    {validDate
                                      ? relativeTime(n.timestamp)
                                      : 'Time unavailable'}
                                  </time>
                                </div>
                                <h4>{text}</h4>
                                {sub && <p>{sub}</p>}
                                {action && (
                                  <Link
                                    className="nc-item-action"
                                    onClick={onClose}
                                    to={action.link}
                                  >
                                    {action.label}
                                    <ArrowUpRight size={14} />
                                  </Link>
                                )}
                              </div>
                              {!n.read && (
                                <span
                                  aria-label="Unread"
                                  className="nc-dot"
                                />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))
              )}
            </div>
            <footer className="nc-footer">
              <span>Showing your latest {notifications.length} events</span>
              <button
                className="nc-text-btn nc-clear"
                disabled={!notifications.length}
                onClick={onClear}
                type="button"
              >
                <Trash2 size={14} /> Clear history
              </button>
            </footer>
          </>
        ) : (
          <div className="nc-settings">
            <div className="nc-settings-intro">
              <SlidersHorizontal size={22} />
              <h3>Make room for what matters.</h3>
              <p>
                Choose which events appear here and raise an alert. Transfer
                completion alerts are optional.
              </p>
            </div>
            {categories.slice(1).map(({ key: group, label }) => (
              <section
                className="nc-setting-group"
                key={group}
              >
                <h3>{label}</h3>
                {NOTIFICATION_TYPES.filter((t) => t.category === group).map(
                  ({ Icon, defaultEnabled, description, key, label: name }) => (
                    <label
                      className="nc-setting-row"
                      key={key}
                    >
                      <span className="nc-setting-icon">
                        <Icon size={18} />
                      </span>
                      <span className="nc-setting-body">
                        <strong>{name}</strong>
                        <span>{description}</span>
                      </span>
                      <span className="nc-toggle">
                        <input
                          aria-label={
                            name +
                            (key === 'DownloadFileComplete'
                              ? ' (individual files)'
                              : key === 'DownloadDirectoryComplete'
                                ? ' (folders)'
                                : '')
                          }
                          checked={settings[key] ?? defaultEnabled}
                          onChange={(e) =>
                            onSettingsChange(key, e.target.checked)
                          }
                          type="checkbox"
                        />
                        <span className="nc-toggle-track" />
                      </span>
                    </label>
                  ),
                )}
              </section>
            ))}
          </div>
        )}
      </section>
    </>
  );
};

export default NotificationCentre;
