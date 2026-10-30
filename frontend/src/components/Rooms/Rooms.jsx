// <copyright file="Rooms.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>
import '../Chat/Chat.css';
import '../Search/Search.css';
import './Rooms.css';
import { activeRoomKey } from '../../config';
import useLatestMessage from '../../hooks/useLatestMessage';
import * as prefs from '../../lib/prefs';
import * as rooms from '../../lib/rooms';
import * as translation from '../../lib/translation';
import {
  avatarColor,
  avatarInitial,
  findFirstUrl,
  groupByDate,
} from '../Chat/chatUtils';
import CommunityWorkspace from '../Chat/CommunityWorkspace';
import EmojiPickerButton from '../Shared/EmojiPickerButton';
import Linkify from '../Shared/Linkify';
import LinkPreviewCard from '../Shared/LinkPreviewCard';
import UsernameLink from '../Shared/UsernameLink';
import RoomUserList from './RoomUserList';
import {
  Globe,
  Hash,
  Languages,
  LogOut,
  MessageCircle,
  Plus,
  Reply,
  Search as SearchIcon,
  Send,
  Users,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { withRouter } from 'react-router-dom';

const roomMessageKey = (message) =>
  `${message.username}|${message.timestamp}|${message.message}`;

const translatePrefKey = (roomName) => `resonance:roomTranslate:${roomName}`;
const replyPrefKey = (roomName) => `resonance:roomReply:${roomName}`;
const SIDEBAR_WIDTH_KEY = 'resonance-rooms-sidebar-width';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const USERS_POLL_MS = 1_000;
const JOINED_POLL_MS = 3_000;
const AVAILABLE_POLL_MS = 15_000;

const baseLang = (code) => (code || '').toUpperCase().split('-')[0];

const formatTimestamp = (timestamp) =>
  new Date(timestamp).toLocaleTimeString('en', {
    hour: 'numeric',
    minute: '2-digit',
  });

// ── Sidebar room row ─────────────────────────────────────────────────────────

// Keep unread message counts separate from the room's user count.
export const RoomListItem = ({
  active,
  joined,
  joining,
  onSelect,
  room,
  unreadCount = 0,
}) => (
  <button
    className={`sr-search-item${active ? ' sr-search-item--active' : ''}`}
    disabled={joining}
    onClick={() => onSelect(room.name)}
    type="button"
  >
    <span className="sr-search-item-icon">
      {joined ? (
        <span className="room-list-dot" />
      ) : (
        <Hash
          size={13}
          strokeWidth={2}
        />
      )}
    </span>
    <span className="sr-search-item-text">{room.name}</span>
    {unreadCount > 0 && (
      <span
        aria-label={`${unreadCount} new messages in ${room.name}`}
        className="room-unread-badge"
        role="img"
        title={`${unreadCount} new messages`}
      >
        <MessageCircle
          aria-hidden="true"
          size={13}
        />
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    )}
    {joining && <span className="sr-search-item-count">Joining…</span>}
  </button>
);

// ── Main component ────────────────────────────────────────────────────────────

const Rooms = ({ history, onRoomRead, unreadCounts = {} }) => {
  const [joinedNames, setJoinedNames] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [active, setActive] = useState('');
  const [room, setRoom] = useState({ messages: [], users: [] });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [roomsTab, setRoomsTab] = useState(() =>
    prefs.get('resonance-rooms-tab', 'joined'),
  );
  const [joiningRoom, setJoiningRoom] = useState(null);
  const [message, setMessage] = useState('');
  const [showUsers, setShowUsers] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(prefs.get(SIDEBAR_WIDTH_KEY, 240));
    return Number.isFinite(saved) ? saved : 240;
  });

  const [translateStatus, setTranslateStatus] = useState({
    defaultTargetLanguage: 'EN',
    enabled: false,
  });
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [replyTranslate, setReplyTranslate] = useState(false);
  const [translations, setTranslations] = useState({});
  const [showOriginal, setShowOriginal] = useState(() => new Set());
  const translationsRef = useRef({});

  const targetLang = translateStatus.defaultTargetLanguage || 'EN';

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const dividerMoveRef = useRef(null);
  const activeRef = useRef('');
  const mountedRef = useRef(true);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ── Fetching ─────────────────────────────────────────────────────────────

  const fetchJoined = useCallback(async () => {
    try {
      const names = (await rooms.getJoined()) || [];
      if (mountedRef.current) setJoinedNames(names);
    } catch {
      // best-effort poll; next tick recovers
    }
  }, []);

  const fetchAvailable = useCallback(async () => {
    try {
      const list = (await rooms.getAvailable()) || [];
      if (mountedRef.current) setAvailableRooms(list);
    } catch {
      // best-effort poll; next tick recovers
    }
  }, []);

  const fetchActiveRoom = useCallback(async () => {
    const roomName = activeRef.current;
    if (!roomName) return;

    try {
      const [messages, users] = await Promise.all([
        rooms.getMessages({ roomName }),
        rooms.getUsers({ roomName }),
      ]);

      if (mountedRef.current && activeRef.current === roomName) {
        setRoom({ messages: messages || [], users: users || [] });
        onRoomRead?.(roomName);
      }
    } catch {
      // best-effort poll; next tick recovers
    }
  }, [onRoomRead]);

  // ── Select / join / leave ───────────────────────────────────────────────

  const selectRoom = useCallback(
    async (roomName) => {
      onRoomRead?.(null);
      setActive(roomName);
      activeRef.current = roomName;
      sessionStorage.setItem(activeRoomKey, roomName);
      setAutoTranslate(Boolean(prefs.get(translatePrefKey(roomName), false)));
      setReplyTranslate(Boolean(prefs.get(replyPrefKey(roomName), false)));
      setMessage('');
      setLoading(true);
      setRoom({ messages: [], users: [] });

      try {
        await fetchActiveRoom();
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setTimeout(() => {
            inputRef.current?.focus();
          }, 50);
        }
      }
    },
    [fetchActiveRoom, onRoomRead],
  );

  const handleSelect = useCallback(
    async (roomName) => {
      if (joinedNames.includes(roomName)) {
        await selectRoom(roomName);
        return;
      }

      setJoiningRoom(roomName);
      try {
        await rooms.join({ roomName });
        await fetchJoined();
        await selectRoom(roomName);
        setSearch('');
      } catch {
        // room may not exist or join was rejected; leave the search box as-is
      } finally {
        if (mountedRef.current) setJoiningRoom(null);
      }
    },
    [fetchJoined, joinedNames, selectRoom],
  );

  const leaveRoom = useCallback(
    async (roomName) => {
      await rooms.leave({ roomName });
      const remaining = joinedNames.filter((name) => name !== roomName);
      setJoinedNames(remaining);
      if (activeRef.current === roomName) {
        const next = remaining[0] || '';
        if (next) await selectRoom(next);
        else {
          setActive('');
          activeRef.current = '';
          setRoom({ messages: [], users: [] });
        }
      }
    },
    [joinedNames, selectRoom],
  );

  // ── Mount ────────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const savedActive = sessionStorage.getItem(activeRoomKey) || '';

    (async () => {
      await fetchJoined();
      await fetchAvailable();
      if (!mountedRef.current) return;

      const names = await rooms.getJoined();
      const initial =
        savedActive && (names || []).includes(savedActive)
          ? savedActive
          : (names || [])[0] || '';
      if (initial) selectRoom(initial);
    })();

    const joinedInterval = window.setInterval(fetchJoined, JOINED_POLL_MS);
    const availableInterval = window.setInterval(
      fetchAvailable,
      AVAILABLE_POLL_MS,
    );
    const messagesInterval = window.setInterval(fetchActiveRoom, USERS_POLL_MS);

    const onDocumentClick = () => setContextMenu(null);
    document.addEventListener('click', onDocumentClick);

    translation
      .getStatus()
      .then((status) => {
        if (mountedRef.current && status) setTranslateStatus(status);
      })
      .catch(() => {});

    return () => {
      mountedRef.current = false;
      onRoomRead?.(null);
      window.clearInterval(joinedInterval);
      window.clearInterval(availableInterval);
      window.clearInterval(messagesInterval);
      document.removeEventListener('click', onDocumentClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  // ── Translation ──────────────────────────────────────────────────────────

  const toggleAutoTranslate = useCallback(() => {
    setAutoTranslate((previous) => {
      const next = !previous;
      if (active) {
        prefs.set(translatePrefKey(active), next);
        if (next) {
          setReplyTranslate(true);
          prefs.set(replyPrefKey(active), true);
        }
      }

      return next;
    });
  }, [active]);

  const toggleReplyTranslate = useCallback(() => {
    setReplyTranslate((previous) => {
      const next = !previous;
      if (active) prefs.set(replyPrefKey(active), next);
      return next;
    });
  }, [active]);

  const toggleShowOriginal = useCallback((key) => {
    setShowOriginal((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const resolveReplyLang = useCallback(async () => {
    const msgs = room.messages || [];
    for (let index = msgs.length - 1; index >= 0; index--) {
      const m = msgs[index];
      if (m.self === true || !m.message?.trim()) continue;

      const cached = translationsRef.current[roomMessageKey(m)];
      if (cached?.detectedSourceLanguage) {
        return baseLang(cached.detectedSourceLanguage);
      }

      try {
        const [probe] = await translation.translate({
          targetLanguage: targetLang,
          texts: [m.message],
        });
        return baseLang(probe?.detectedSourceLanguage);
      } catch {
        return null;
      }
    }

    return null;
  }, [room.messages, targetLang]);

  useEffect(() => {
    if (!translateStatus.enabled || !autoTranslate || !active) return undefined;

    const pending = (room.messages || []).filter(
      (m) =>
        m.message &&
        m.message.trim() &&
        !(roomMessageKey(m) in translationsRef.current) &&
        (!m.self || !translation.recallOutgoing(m.message)),
    );

    if (pending.length === 0) return undefined;

    let cancelled = false;
    translation
      .translate({
        targetLanguage: targetLang,
        texts: pending.map((m) => m.message),
      })
      .then((results) => {
        if (cancelled || !mountedRef.current) return;
        setTranslations((previous) => {
          const next = { ...previous };
          for (const [index, m] of pending.entries()) {
            next[roomMessageKey(m)] = results[index];
          }

          return next;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    active,
    autoTranslate,
    translateStatus.enabled,
    targetLang,
    room.messages,
  ]);

  // ── Sending ──────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    if (!active || !message.trim()) return;

    let toSend = message;
    if (translateStatus.enabled && replyTranslate) {
      const lang = await resolveReplyLang();
      if (lang && lang !== targetLang.toUpperCase()) {
        try {
          const [translated] = await translation.translate({
            targetLanguage: lang,
            texts: [message],
          });
          if (translated?.text) {
            toSend = translated.text;
            translation.rememberOutgoing(toSend, message, lang);
          }
        } catch {
          // fall back to sending the original text
        }
      }
    }

    await rooms.sendMessage({ message: toSend, roomName: active });
    setMessage('');
    fetchActiveRoom();
  }, [
    active,
    message,
    replyTranslate,
    resolveReplyLang,
    targetLang,
    translateStatus.enabled,
    fetchActiveRoom,
  ]);

  const handleEmojiSelect = useCallback(
    (emoji) => {
      const input = inputRef.current;
      const start = input?.selectionStart ?? message.length;
      const end = input?.selectionEnd ?? message.length;

      setMessage(
        (previous) => previous.slice(0, start) + emoji + previous.slice(end),
      );

      setTimeout(() => {
        input?.focus();
        const cursor = start + emoji.length;
        input?.setSelectionRange(cursor, cursor);
      }, 0);
    },
    [message],
  );

  // ── Context menu ─────────────────────────────────────────────────────────

  const openContextMenu = useCallback((event, msg) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ left: event.clientX, top: event.clientY, msg });
  }, []);

  const handleReply = useCallback(
    (msg) => {
      const target = msg || contextMenu?.msg;
      if (!target) return;
      setMessage(
        (previous) => `${previous}[${target.username}] ${target.message} --> `,
      );
      setContextMenu(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [contextMenu],
  );

  const handleUserProfile = useCallback(() => {
    history.push('/users', { user: contextMenu.msg.username });
    setContextMenu(null);
  }, [contextMenu, history]);

  const handleBrowseShares = useCallback(() => {
    history.push('/browse', { user: contextMenu.msg.username });
    setContextMenu(null);
  }, [contextMenu, history]);

  // ── Resizable divider ────────────────────────────────────────────────────

  const onDividerMouseDown = (e) => {
    e.preventDefault();
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    dividerMoveRef.current = (moveEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSidebarWidth(
        Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, moveEvent.clientX - rect.left),
        ),
      );
    };

    const onMouseUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setSidebarWidth((w) => {
        prefs.set(SIDEBAR_WIDTH_KEY, w);
        return w;
      });
      document.removeEventListener('mousemove', dividerMoveRef.current);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', dividerMoveRef.current);
    document.addEventListener('mouseup', onMouseUp);
  };

  // ── Derived sidebar lists ────────────────────────────────────────────────

  const availableByName = useMemo(() => {
    const map = new Map();
    for (const r of availableRooms) map.set(r.name, r);
    return map;
  }, [availableRooms]);

  const joinedRooms = useMemo(
    () =>
      joinedNames.map((name) => ({
        name,
        userCount:
          availableByName.get(name)?.userCount ??
          (name === active ? room.users.length : undefined),
      })),
    [joinedNames, availableByName, active, room.users.length],
  );

  const query = search.trim().toLowerCase();

  const joinedFiltered = useMemo(
    () =>
      joinedRooms
        .filter((r) => r.name.toLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [joinedRooms, query],
  );

  const browseFiltered = useMemo(
    () =>
      availableRooms
        .filter(
          (r) =>
            !joinedNames.includes(r.name) &&
            r.name.toLowerCase().includes(query),
        )
        .sort((a, b) => b.userCount - a.userCount),
    [availableRooms, joinedNames, query],
  );

  const noMatches =
    roomsTab === 'joined'
      ? joinedFiltered.length === 0
      : browseFiltered.length === 0;
  const exactExists =
    query.length > 0 &&
    (roomsTab === 'joined'
      ? joinedNames.some((n) => n.toLowerCase() === query)
      : availableRooms.some((r) => r.name.toLowerCase() === query));

  // ── Messages, grouped for a flat Discord-style render ───────────────────

  const groups = useMemo(() => groupByDate(room.messages), [room.messages]);

  const flatItems = useMemo(() => {
    const result = [];
    for (const group of groups) {
      result.push({ type: 'date', label: group.label });
      for (const [index, m] of group.messages.entries()) {
        const previous = group.messages[index - 1];
        result.push({
          type: 'msg',
          msg: m,
          showHeader: !previous || previous.username !== m.username,
        });
      }
    }

    return result;
  }, [groups]);

  useLatestMessage(messagesRef, {
    active,
    count: flatItems.length,
    latest: room.messages.length ? roomMessageKey(room.messages.at(-1)) : null,
    loading,
  });

  return (
    <>
      <CommunityWorkspace
        description="Find your people. Talk music, share discoveries."
        title="Chatrooms"
      >
        <div
          className="sr-root rooms-root community-root"
          ref={rootRef}
        >
          {/* ── Sidebar ── */}
          <div
            className="sr-sidebar"
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          >
            <div className="sr-sidebar-top">
              <span className="chat-sidebar-title">
                <Hash
                  size={14}
                  strokeWidth={2}
                />
                Rooms
              </span>
            </div>
            <div className="room-search-wrap">
              <div className="sr-input-wrap">
                <SearchIcon
                  className="sr-input-icon"
                  size={13}
                />
                <input
                  aria-label="Search rooms"
                  className="sr-input"
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rooms…"
                  type="text"
                  value={search}
                />
              </div>
            </div>

            <div className="room-tabs">
              <button
                aria-pressed={roomsTab === 'joined'}
                className={`room-tab${roomsTab === 'joined' ? ' active' : ''}`}
                onClick={() => {
                  prefs.set('resonance-rooms-tab', 'joined');
                  setRoomsTab('joined');
                }}
                type="button"
              >
                Joined
              </button>
              <button
                aria-pressed={roomsTab === 'browse'}
                className={`room-tab${roomsTab === 'browse' ? ' active' : ''}`}
                onClick={() => {
                  prefs.set('resonance-rooms-tab', 'browse');
                  setRoomsTab('browse');
                }}
                type="button"
              >
                Browse
              </button>
            </div>

            <div className="sr-search-list">
              {roomsTab === 'joined' &&
                joinedFiltered.map((r) => (
                  <RoomListItem
                    active={active === r.name}
                    joined
                    key={r.name}
                    onSelect={handleSelect}
                    room={r}
                    unreadCount={unreadCounts[r.name] ?? 0}
                  />
                ))}
              {roomsTab === 'browse' &&
                browseFiltered.map((r) => (
                  <RoomListItem
                    active={false}
                    joined={false}
                    joining={joiningRoom === r.name}
                    key={r.name}
                    onSelect={handleSelect}
                    room={r}
                    unreadCount={unreadCounts[r.name] ?? 0}
                  />
                ))}
              {noMatches && query.length === 0 && (
                <div className="sr-search-list-empty">
                  {roomsTab === 'joined'
                    ? "You haven't joined any rooms — try Browse"
                    : 'No rooms available'}
                </div>
              )}
              {noMatches && query.length > 0 && !exactExists && (
                <button
                  className="sr-search-item room-join-custom"
                  disabled={joiningRoom === search.trim()}
                  onClick={() => handleSelect(search.trim())}
                  type="button"
                >
                  <span className="sr-search-item-icon">
                    <Plus
                      size={13}
                      strokeWidth={2}
                    />
                  </span>
                  <span className="sr-search-item-text">
                    Join &ldquo;{search.trim()}&rdquo;
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* ── Resize divider ── */}
          <div
            aria-orientation="vertical"
            className="sr-divider"
            onMouseDown={onDividerMouseDown}
            role="separator"
          />

          {/* ── Main panel ── */}
          <div className="sr-main">
            {active ? (
              <div className="chat-main">
                <div className="chat-header">
                  <div className="chat-header-avatar room-header-avatar">
                    <Hash size={16} />
                  </div>
                  <div className="chat-header-info">
                    <span className="chat-header-name">{active}</span>
                    <span className="community-context">
                      Room conversation · {room.users.length} members
                    </span>
                  </div>
                  <div className="sr-detail-header-actions">
                    {translateStatus.enabled && (
                      <button
                        className={`sr-btn hover-fx chat-translate-toggle${autoTranslate ? ' chat-translate-toggle--on' : ''}`}
                        onClick={toggleAutoTranslate}
                        title={
                          autoTranslate
                            ? `Auto-translating to ${translation.languageName(targetLang)}`
                            : 'Auto-translate messages'
                        }
                        type="button"
                      >
                        <Languages size={13} />{' '}
                        {autoTranslate
                          ? `Translating → ${targetLang}`
                          : 'Translate'}
                      </button>
                    )}
                    <button
                      aria-expanded={showUsers}
                      className={`sr-btn hover-fx${showUsers ? ' chat-translate-toggle--on' : ''}`}
                      onClick={() => setShowUsers((v) => !v)}
                      title={
                        showUsers ? 'Hide member list' : 'Show member list'
                      }
                      type="button"
                    >
                      <Users size={13} /> Members · {room.users.length}
                    </button>
                    <button
                      className="sr-btn sr-btn--danger hover-fx"
                      onClick={() => leaveRoom(active)}
                      title="Leave room"
                      type="button"
                    >
                      <LogOut size={13} /> Leave
                    </button>
                  </div>
                </div>

                <div
                  className="chat-messages room-messages"
                  ref={messagesRef}
                >
                  {loading ? (
                    <div className="chat-loading">
                      <span className="chat-loading-dot" />
                      <span className="chat-loading-dot" />
                      <span className="chat-loading-dot" />
                    </div>
                  ) : flatItems.length === 0 ? (
                    <div className="chat-empty-state">
                      <div className="chat-empty-avatar room-header-avatar">
                        <Hash size={22} />
                      </div>
                      <p>
                        No messages yet in <strong>{active}</strong>
                      </p>
                    </div>
                  ) : (
                    flatItems.map((item) => {
                      if (item.type === 'date') {
                        return (
                          <div
                            className="chat-date-sep"
                            key={`date-${item.label}`}
                          >
                            <span>{item.label}</span>
                          </div>
                        );
                      }

                      const m = item.msg;
                      const key = roomMessageKey(m);
                      const tr = translations[key];
                      const canTranslate =
                        translateStatus.enabled && autoTranslate && !m.self;
                      const translatedDiffers =
                        Boolean(tr?.text) &&
                        Boolean(tr?.detectedSourceLanguage) &&
                        baseLang(tr.detectedSourceLanguage) !==
                          targetLang.toUpperCase();
                      const viewingOriginal = showOriginal.has(key);
                      const showTranslated =
                        canTranslate && translatedDiffers && !viewingOriginal;

                      const captured = m.self
                        ? translation.recallOutgoing(m.message)
                        : null;
                      const backTranslation =
                        m.self &&
                        !captured &&
                        Boolean(tr?.text) &&
                        Boolean(tr?.detectedSourceLanguage) &&
                        baseLang(tr.detectedSourceLanguage) !==
                          targetLang.toUpperCase()
                          ? tr
                          : null;
                      const selfForeign =
                        (Boolean(captured) &&
                          captured.original !== m.message) ||
                        Boolean(backTranslation);
                      const selfExact = Boolean(captured);
                      const selfInLang = captured
                        ? captured.original
                        : backTranslation?.text;
                      const selfSourceLang = captured
                        ? captured.lang
                        : backTranslation?.detectedSourceLanguage;
                      const showSelfInLang = selfForeign && viewingOriginal;
                      const displayText = m.self
                        ? showSelfInLang
                          ? selfInLang
                          : m.message
                        : showTranslated
                          ? tr.text
                          : m.message;
                      const previewUrl = findFirstUrl(displayText);

                      return (
                        <div
                          className={`chat-msg-row${m.self ? ' chat-msg-row--self' : ''}`}
                          key={key}
                          onContextMenu={(e) => openContextMenu(e, m)}
                        >
                          {!m.self && (
                            <div
                              className={`chat-bubble-avatar${item.showHeader ? ' chat-bubble-avatar--top' : ' chat-bubble-avatar--ghost'}`}
                              style={{ background: avatarColor(m.username) }}
                            >
                              {avatarInitial(m.username)}
                            </div>
                          )}
                          <div className="chat-bubble-col">
                            {!m.self && item.showHeader && (
                              <div className="room-msg-header">
                                <UsernameLink username={m.username} />
                              </div>
                            )}
                            <div
                              className={`chat-bubble${m.self ? ' chat-bubble--self' : ' chat-bubble--other'}`}
                            >
                              <Linkify text={displayText} />
                              {previewUrl && (
                                <LinkPreviewCard url={previewUrl} />
                              )}
                            </div>
                            {canTranslate && translatedDiffers && (
                              <button
                                className="chat-translate-note"
                                onClick={() => toggleShowOriginal(key)}
                                type="button"
                              >
                                {showTranslated
                                  ? `Translated from ${translation.languageName(tr.detectedSourceLanguage)} · Show original`
                                  : 'Show translation'}
                              </button>
                            )}
                            {selfForeign && (
                              <button
                                className="chat-translate-note chat-translate-note--self"
                                onClick={() => toggleShowOriginal(key)}
                                type="button"
                              >
                                {showSelfInLang
                                  ? 'Show sent message'
                                  : `Sent in ${translation.languageName(selfSourceLang)} · ${selfExact ? 'Show original' : `Show in ${translation.languageName(targetLang)}`}`}
                              </button>
                            )}
                            <span className="chat-bubble-time">
                              {formatTimestamp(m.timestamp)}
                            </span>
                          </div>
                          <div className="chat-msg-actions">
                            <button
                              className="chat-msg-action-btn hover-fx"
                              onClick={() => handleReply(m)}
                              title="Reply"
                              type="button"
                            >
                              <Reply
                                size={13}
                                strokeWidth={2}
                              />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="chat-input-bar">
                  <EmojiPickerButton onSelect={handleEmojiSelect} />
                  {translateStatus.enabled && (
                    <button
                      className={`chat-reply-toggle hover-fx${replyTranslate ? ' chat-reply-toggle--on' : ''}`}
                      onClick={toggleReplyTranslate}
                      title={
                        replyTranslate
                          ? "Reply translation on — your message is translated into the other person's language before sending"
                          : 'Reply in their language'
                      }
                      type="button"
                    >
                      <Globe
                        size={16}
                        strokeWidth={2}
                      />
                    </button>
                  )}
                  <input
                    aria-label={`Message room ${active}`}
                    autoComplete="off"
                    className="chat-input-field"
                    data-lpignore="true"
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={
                      replyTranslate
                        ? `Reply in ${active}'s language…`
                        : `Message #${active}…`
                    }
                    ref={inputRef}
                    type="text"
                    value={message}
                  />
                  <button
                    className="chat-send-btn hover-fx"
                    disabled={!message.trim()}
                    onClick={sendMessage}
                    title="Send"
                    type="button"
                  >
                    <Send
                      size={16}
                      strokeWidth={2}
                    />
                    <span>Send</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="sr-empty">
                <Hash
                  size={32}
                  strokeWidth={1.25}
                />
                <h2>A room for every kind of listener</h2>
                <p>
                  Browse the room list to find a conversation, or return to a
                  room you’ve joined.
                </p>
              </div>
            )}
          </div>

          {/* ── Member list ── */}
          {active && showUsers && (
            <div className="room-users-panel">
              <div className="room-users-panel-header">
                Members — {room.users.length}
              </div>
              <RoomUserList users={room.users} />
            </div>
          )}
        </div>
      </CommunityWorkspace>

      {contextMenu && (
        <div
          className="chat-ctx-menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <div className="chat-ctx-username">{contextMenu.msg.username}</div>
          <button
            className="chat-ctx-item"
            onClick={() => handleReply(contextMenu.msg)}
            type="button"
          >
            Reply
          </button>
          <button
            className="chat-ctx-item"
            onClick={handleUserProfile}
            type="button"
          >
            User Profile
          </button>
          <button
            className="chat-ctx-item"
            onClick={handleBrowseShares}
            type="button"
          >
            Browse Shares
          </button>
        </div>
      )}
    </>
  );
};

export default withRouter(Rooms);
