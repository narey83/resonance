// <copyright file="Chat.jsx" company="JP Dillingham">
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
import './Chat.css';
import '../Search/Search.css';
import { activeChatKey } from '../../config';
import useLatestMessage from '../../hooks/useLatestMessage';
import * as chat from '../../lib/chat';
import { onPrivateMessage } from '../../lib/chatEvents';
import * as prefs from '../../lib/prefs';
import * as translation from '../../lib/translation';
import EmojiPickerButton from '../Shared/EmojiPickerButton';
import Linkify from '../Shared/Linkify';
import LinkPreviewCard from '../Shared/LinkPreviewCard';
import UsernameLink from '../Shared/UsernameLink';
import {
  avatarColor,
  avatarInitial,
  findFirstUrl,
  formatTime,
  groupByDate,
} from './chatUtils';
import CommunityWorkspace from './CommunityWorkspace';
import SendMessageModal from './SendMessageModal';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Globe,
  Languages,
  MessageCircle,
  MessageSquare,
  Plus,
  Reply,
  Send,
  X,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { withRouter } from 'react-router-dom';

// ── Context menu ──────────────────────────────────────────────────────────────

const ContextMenu = ({ friends, menu, onAddFriend, onBrowse }) => {
  if (!menu) return null;
  const isFriend = friends.has(menu.username);
  return (
    <div
      className="chat-ctx-menu"
      style={{ left: menu.left, top: menu.top }}
    >
      <div className="chat-ctx-username">{menu.username}</div>
      <button
        className={`chat-ctx-item${isFriend ? ' chat-ctx-item--done' : ''}`}
        onClick={() => onAddFriend(menu.username)}
        type="button"
      >
        {isFriend ? '✅ Friend added' : '🤝 Add as friend'}
      </button>
      <button
        className="chat-ctx-item"
        onClick={() => onBrowse(menu.username)}
        type="button"
      >
        📁 Browse shared files
      </button>
    </div>
  );
};

// ── Conversation list item ──────────────────────────────────────────────────────

// Unread indicators remain separate from the conversation's delete action.
export const ConversationItem = ({
  active,
  conv,
  onContextMenu,
  onDelete,
  onSelect,
}) => (
  <div
    className={`chat-conv-item sr-search-item${active === conv.username ? ' sr-search-item--active' : ''}`}
    onClick={() => onSelect(conv.username)}
    onContextMenu={(e) => onContextMenu(e, conv.username)}
    onKeyDown={(e) => e.key === 'Enter' && onSelect(conv.username)}
    role="button"
    tabIndex={0}
  >
    <div
      className="chat-conv-avatar"
      style={{ background: avatarColor(conv.username) }}
    >
      {avatarInitial(conv.username)}
    </div>
    <span className="sr-search-item-text">{conv.username}</span>
    {conv.unAcknowledgedMessageCount > 0 && (
      <span
        aria-label={`${conv.unAcknowledgedMessageCount} new messages from ${conv.username}`}
        className="chat-conv-badge"
        role="img"
        title={`${conv.unAcknowledgedMessageCount} new messages`}
      >
        <MessageCircle
          aria-hidden="true"
          size={13}
        />
        {conv.unAcknowledgedMessageCount > 99
          ? '99+'
          : conv.unAcknowledgedMessageCount}
      </span>
    )}
    <button
      className="chat-conv-delete"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(conv.username);
      }}
      title="Delete conversation"
      type="button"
    >
      <X
        size={12}
        strokeWidth={2}
      />
    </button>
  </div>
);

// ── Constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH_KEY = 'resonance-chat-sidebar-width';
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 420;

const translatePrefKey = (username) => `resonance:chatTranslate:${username}`;
const replyPrefKey = (username) => `resonance:chatReply:${username}`;

const baseLang = (code) => (code || '').toUpperCase().split('-')[0];

// ── Main component ────────────────────────────────────────────────────────────

const Chat = ({ history, location, onConversationRead }) => {
  const [active, setActive] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [conversations, setConversations] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [friends, setFriends] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(prefs.get(SIDEBAR_WIDTH_KEY, 256));
    return Number.isFinite(saved) ? saved : 256;
  });

  // Translation
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

  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const dividerMoveRef = useRef(null);
  const intervalRef = useRef(null);
  const activeRef = useRef('');
  // Polling, push-triggered refreshes and the async action handlers all set
  // state after awaits, so a per-effect cancelled flag can't cover every
  // caller — guard setState with a ref that flips on unmount.
  const mountedRef = useRef(true);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // ── Fetch conversations ──────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    try {
      let fetched = await chat.getAll();
      fetched = fetched.filter((c) => c.username !== '..');

      let convMap =
        fetched.length === 0
          ? {}
          : fetched.reduce((map, c) => {
              map[c.username] = c;
              return map;
            }, {});

      const currentActive = activeRef.current;
      const activeConv = convMap[currentActive];

      if (activeConv) {
        if (activeConv.hasUnAcknowledgedMessages) {
          await chat.acknowledge({ username: currentActive });
          onConversationRead?.();
        }

        const activeDetail = await chat.get({ username: currentActive });
        convMap = { ...convMap, [currentActive]: activeDetail };
      }

      if (!mountedRef.current) return;

      setConversations((previous) => {
        // Preserve locally-initiated conversations not yet on the server
        const merged = { ...convMap };
        for (const [username, conv] of Object.entries(previous)) {
          if (!merged[username]) merged[username] = conv;
        }

        // Only redirect away if the active user is absent from both server and local state
        if (
          currentActive &&
          !convMap[currentActive] &&
          !previous[currentActive]
        ) {
          const first = Object.keys(merged)[0] || '';
          setActive(first);
          activeRef.current = first;
          sessionStorage.setItem(activeChatKey, first);
        }

        return merged;
      });
    } catch (error) {
      // Every caller of this — mount, the 5s poll, the hub event — left the rejection
      // unhandled, so a bouncing backend threw 502s straight into the error overlay.
      // Announcing the outage is the connection manager's job; the next poll recovers.
      console.debug('failed to fetch conversations', error);
    }
  }, [onConversationRead]);

  // ── Open / initiate conversation ─────────────────────────────────────────────

  const initiateConversation = useCallback((username) => {
    if (!username) return;
    setConversations((previous) => ({
      ...previous,
      [username]: previous[username] ?? {
        username,
        messages: [],
        unAcknowledgedMessageCount: 0,
      },
    }));
    setActive(username);
    activeRef.current = username;
    sessionStorage.setItem(activeChatKey, username);
    setMessage('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // ── Select conversation ──────────────────────────────────────────────────────

  const selectConversation = useCallback(
    async (username) => {
      setActive(username);
      activeRef.current = username;
      sessionStorage.setItem(activeChatKey, username);
      setMessage('');

      if (!username) return;

      setLoading(true);
      try {
        let full = await chat.get({ username });
        if (
          mountedRef.current &&
          activeRef.current === username &&
          full.hasUnAcknowledgedMessages
        ) {
          await chat.acknowledge({ username });
          full = {
            ...full,
            hasUnAcknowledgedMessages: false,
            unAcknowledgedMessageCount: 0,
          };
          onConversationRead?.();
        }

        if (mountedRef.current && activeRef.current === username) {
          setConversations((previous) => ({ ...previous, [username]: full }));
        }
      } catch (error) {
        console.debug('failed to open conversation', error);
      } finally {
        if (mountedRef.current && activeRef.current === username) {
          setLoading(false);
          inputRef.current?.focus();
        }
      }
    },
    [onConversationRead],
  );

  // ── Mount ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const onDocumentClick = () => setContextMenu(null);
    document.addEventListener('click', onDocumentClick);

    const userFromNav =
      location?.state?.user ||
      new URLSearchParams(location?.search).get('user');
    const savedActive =
      userFromNav || sessionStorage.getItem(activeChatKey) || '';
    activeRef.current = savedActive;
    setActive(savedActive);

    fetchConversations().then(() => {
      if (userFromNav) initiateConversation(userFromNav);
      else selectConversation(savedActive || activeRef.current);
    });

    intervalRef.current = window.setInterval(fetchConversations, 5_000);

    // Push-triggered refresh so incoming messages land as soon as the
    // notification does, instead of waiting for the next poll tick.
    const unsubscribe = onPrivateMessage(() => fetchConversations());

    return () => {
      mountedRef.current = false;
      clearInterval(intervalRef.current);
      document.removeEventListener('click', onDocumentClick);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Translation ──────────────────────────────────────────────────────────────

  useEffect(() => {
    translation
      .getStatus()
      .then((status) => {
        if (mountedRef.current && status) setTranslateStatus(status);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  // Load the per-conversation translate preferences when the active chat changes.
  useEffect(() => {
    setAutoTranslate(
      active ? Boolean(prefs.get(translatePrefKey(active), false)) : false,
    );
    setReplyTranslate(
      active ? Boolean(prefs.get(replyPrefKey(active), false)) : false,
    );
  }, [active]);

  const toggleAutoTranslate = useCallback(() => {
    setAutoTranslate((previous) => {
      const next = !previous;
      if (active) prefs.set(translatePrefKey(active), next);
      if (next) {
        setReplyTranslate(true);
        if (active) prefs.set(replyPrefKey(active), true);
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

  // Resolve the language to translate an outgoing reply into: the most recent
  // incoming message's detected language (from cache, or probed on demand).
  const resolveReplyLang = useCallback(async () => {
    const msgs = conversations[active]?.messages || [];
    for (let index = msgs.length - 1; index >= 0; index--) {
      const m = msgs[index];
      if (m.direction === 'Out' || !m.message?.trim()) continue;

      const cached = translationsRef.current[translation.messageKey(m)];
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
  }, [active, conversations, targetLang]);

  const toggleShowOriginal = useCallback((key) => {
    setShowOriginal((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Translate any not-yet-translated incoming messages in the active conversation.
  useEffect(() => {
    if (!translateStatus.enabled || !autoTranslate || !active) return undefined;

    const msgs = conversations[active]?.messages || [];
    // Translate incoming messages, plus your own sent messages that we didn't
    // capture an original for (so a foreign-language send can be read back).
    const pending = msgs.filter(
      (m) =>
        m.message &&
        m.message.trim() &&
        !(translation.messageKey(m) in translationsRef.current) &&
        (m.direction !== 'Out' || !translation.recallOutgoing(m.message)),
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
            next[translation.messageKey(m)] = results[index];
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
    conversations,
  ]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const sendReply = useCallback(async () => {
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
            // Remember what we typed so the sent bubble can reveal the original.
            translation.rememberOutgoing(toSend, message, lang);
          }
        } catch {
          /* fall back to sending the original text */
        }
      }
    }

    await chat.send({ username: active, message: toSend });
    if (!mountedRef.current) return;
    setMessage('');
    fetchConversations();
  }, [
    active,
    fetchConversations,
    message,
    replyTranslate,
    resolveReplyLang,
    targetLang,
    translateStatus.enabled,
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

  const handleReply = useCallback(
    (msg) => {
      if (!msg) return;
      const label = msg.direction === 'Out' ? 'You' : msg.username || active;
      setMessage((previous) => `${previous}[${label}] ${msg.message} --> `);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [active],
  );

  const deleteConversation = useCallback(
    async (username) => {
      try {
        await chat.remove({ username });
      } catch {
        /* local-only conversation, no server record */
      }

      if (!mountedRef.current) return;

      setConversations((previous) => {
        const next = { ...previous };
        delete next[username];
        return next;
      });
      if (activeRef.current === username) {
        const first =
          Object.keys(conversations).find((u) => u !== username) || '';
        selectConversation(first);
      }
    },
    [conversations, selectConversation],
  );

  const openContextMenu = useCallback((event, username) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ left: event.clientX, top: event.clientY, username });
  }, []);

  const handleAddFriend = useCallback((username) => {
    setFriends((previous) => new Set([...previous, username]));
    setContextMenu(null);
  }, []);

  const handleBrowseFiles = useCallback(
    (username) => {
      history.push('/browse', { user: username });
      setContextMenu(null);
    },
    [history],
  );

  // ── Resizable divider ────────────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────────

  const sortedConvList = useMemo(() => {
    const lastActivity = (conv) =>
      conv.lastMessageTimestamp
        ? new Date(conv.lastMessageTimestamp).getTime()
        : Date.now();

    return Object.values(conversations)
      .filter((conversation) =>
        conversation.username
          .toLowerCase()
          .includes(conversationQuery.trim().toLowerCase()),
      )
      .sort((a, b) => lastActivity(b) - lastActivity(a));
  }, [conversationQuery, conversations]);

  const newConvList = sortedConvList.filter(
    (conv) => conv.unAcknowledgedMessageCount > 0,
  );
  const otherConvList = sortedConvList.filter(
    (conv) => !(conv.unAcknowledgedMessageCount > 0),
  );

  const messages = conversations[active]?.messages || [];
  const groups = groupByDate(messages);

  const flatItems = useMemo(() => {
    const result = [];
    for (const group of groups) {
      result.push({ type: 'date', label: group.label });
      for (let index = 0; index < group.messages.length; index++) {
        const message_ = group.messages[index];
        const previousMessage = group.messages[index - 1];
        const isSelf = message_.direction === 'Out';
        const showAvatar =
          !isSelf && (!previousMessage || previousMessage.direction === 'Out');
        result.push({ type: 'msg', msg: message_, isSelf, showAvatar });
      }
    }

    return result;
  }, [groups]);

  const messageVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => chatScrollRef.current,
    estimateSize: (index) => (flatItems[index]?.type === 'date' ? 52 : 60),
    overscan: 8,
  });

  useLatestMessage(chatScrollRef, {
    active,
    count: flatItems.length,
    latest: messages.length ? translation.messageKey(messages.at(-1)) : null,
    loading,
    virtualizer: messageVirtualizer,
  });

  return (
    <>
      <CommunityWorkspace
        action={
          <SendMessageModal
            centered
            initiateConversation={initiateConversation}
            size="small"
            trigger={
              <button
                className="sr-wizard-primary"
                type="button"
              >
                <Plus size={16} /> New conversation
              </button>
            }
          />
        }
        description="Your conversations, all in one place."
        title="Messages"
      >
        <div
          className="sr-root community-root"
          ref={rootRef}
        >
          {/* ── Sidebar ── */}
          <div
            className="sr-sidebar"
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          >
            <div className="sr-sidebar-top">
              <span className="chat-sidebar-title">
                <MessageSquare
                  size={14}
                  strokeWidth={2}
                />
                Inbox
              </span>
            </div>

            <div className="community-list-search">
              <label
                className="sr-eyebrow"
                htmlFor="conversation-filter"
              >
                FIND A CONVERSATION
              </label>
              <input
                id="conversation-filter"
                onChange={(event) => setConversationQuery(event.target.value)}
                placeholder="Search conversations…"
                type="search"
                value={conversationQuery}
              />
            </div>
            <div className="sr-search-list">
              {sortedConvList.length === 0 ? (
                <div className="sr-search-list-empty">
                  {conversationQuery.trim()
                    ? 'No matching conversations'
                    : 'No conversations yet'}
                </div>
              ) : (
                <>
                  {newConvList.length > 0 && (
                    <>
                      <div className="chat-conv-section-label">New</div>
                      {newConvList.map((conv) => (
                        <ConversationItem
                          active={active}
                          conv={conv}
                          key={conv.username}
                          onContextMenu={openContextMenu}
                          onDelete={deleteConversation}
                          onSelect={selectConversation}
                        />
                      ))}
                    </>
                  )}
                  {otherConvList.length > 0 && (
                    <>
                      {newConvList.length > 0 && (
                        <div className="chat-conv-section-label">
                          Conversations
                        </div>
                      )}
                      {otherConvList.map((conv) => (
                        <ConversationItem
                          active={active}
                          conv={conv}
                          key={conv.username}
                          onContextMenu={openContextMenu}
                          onDelete={deleteConversation}
                          onSelect={selectConversation}
                        />
                      ))}
                    </>
                  )}
                </>
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
                {/* Header */}
                <div className="chat-header">
                  <div
                    className="chat-header-avatar"
                    style={{ background: avatarColor(active) }}
                  >
                    {avatarInitial(active)}
                  </div>
                  <div className="chat-header-info">
                    <UsernameLink
                      active="chat"
                      className="chat-header-name"
                      username={active}
                    />
                    <span className="community-context">
                      Private conversation
                    </span>
                  </div>
                  <div className="sr-detail-header-actions">
                    {translateStatus.enabled && (
                      <button
                        className={`sr-btn hover-fx chat-translate-toggle${autoTranslate ? ' chat-translate-toggle--on' : ''}`}
                        onClick={toggleAutoTranslate}
                        title={
                          autoTranslate
                            ? `Auto-translating incoming messages to ${translation.languageName(targetLang)}`
                            : 'Auto-translate incoming messages'
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
                      className="sr-btn sr-btn--danger hover-fx"
                      onClick={() => deleteConversation(active)}
                      title="Delete conversation"
                      type="button"
                    >
                      <X size={13} /> Delete
                    </button>
                  </div>
                </div>

                {/* Messages */}
                <div
                  className="chat-messages"
                  ref={chatScrollRef}
                >
                  {loading ? (
                    <div className="chat-loading">
                      <span className="chat-loading-dot" />
                      <span className="chat-loading-dot" />
                      <span className="chat-loading-dot" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="chat-empty-state">
                      <div
                        className="chat-empty-avatar"
                        style={{ background: avatarColor(active) }}
                      >
                        {avatarInitial(active)}
                      </div>
                      <p>
                        Start a conversation with <strong>{active}</strong>
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        height: messageVirtualizer.getTotalSize(),
                        position: 'relative',
                      }}
                    >
                      {messageVirtualizer.getVirtualItems().map((vRow) => {
                        const item = flatItems[vRow.index];
                        const msgKey =
                          item.type === 'msg'
                            ? translation.messageKey(item.msg)
                            : null;
                        const tr = msgKey ? translations[msgKey] : null;
                        const canTranslate =
                          item.type === 'msg' &&
                          !item.isSelf &&
                          autoTranslate &&
                          translateStatus.enabled;
                        const translatedDiffers =
                          Boolean(tr?.text) &&
                          Boolean(tr?.detectedSourceLanguage) &&
                          tr.detectedSourceLanguage
                            .toUpperCase()
                            .split('-')[0] !== targetLang.toUpperCase();
                        const viewingOriginal = msgKey
                          ? showOriginal.has(msgKey)
                          : false;
                        const showTranslated =
                          canTranslate && translatedDiffers && !viewingOriginal;
                        // Your own message shown in your language: the exact
                        // original if we captured it at send time, otherwise a
                        // back-translation of the sent (foreign) text.
                        const captured =
                          item.type === 'msg' && item.isSelf
                            ? translation.recallOutgoing(item.msg.message)
                            : null;
                        const backTranslation =
                          item.isSelf &&
                          !captured &&
                          Boolean(tr?.text) &&
                          Boolean(tr?.detectedSourceLanguage) &&
                          tr.detectedSourceLanguage
                            .toUpperCase()
                            .split('-')[0] !== targetLang.toUpperCase()
                            ? tr
                            : null;
                        const selfForeign =
                          (Boolean(captured) &&
                            captured.original !== item.msg.message) ||
                          Boolean(backTranslation);
                        const selfExact = Boolean(captured);
                        const selfInLang = captured
                          ? captured.original
                          : backTranslation?.text;
                        const selfSourceLang = captured
                          ? captured.lang
                          : backTranslation?.detectedSourceLanguage;
                        const showSelfInLang = selfForeign && viewingOriginal;
                        const displayText =
                          item.type === 'msg'
                            ? item.isSelf
                              ? showSelfInLang
                                ? selfInLang
                                : item.msg.message
                              : showTranslated
                                ? tr.text
                                : item.msg.message
                            : null;
                        const previewUrl = findFirstUrl(displayText);
                        return (
                          <div
                            data-index={vRow.index}
                            key={vRow.key}
                            ref={messageVirtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              transform: `translateY(${vRow.start}px)`,
                            }}
                          >
                            {item.type === 'date' ? (
                              <div className="chat-date-sep">
                                <span>{item.label}</span>
                              </div>
                            ) : (
                              <div
                                className={`chat-msg-row${item.isSelf ? ' chat-msg-row--self' : ''}`}
                              >
                                {!item.isSelf && (
                                  <div
                                    className={`chat-bubble-avatar${item.showAvatar ? '' : ' chat-bubble-avatar--ghost'}`}
                                    onContextMenu={(e) =>
                                      openContextMenu(
                                        e,
                                        item.msg.username || active,
                                      )
                                    }
                                    style={{
                                      background: avatarColor(
                                        item.msg.username || active,
                                      ),
                                    }}
                                    title="Right-click for options"
                                  >
                                    {avatarInitial(item.msg.username || active)}
                                  </div>
                                )}
                                <div className="chat-bubble-col">
                                  <div
                                    className={`chat-bubble${item.isSelf ? ' chat-bubble--self' : ' chat-bubble--other'}`}
                                  >
                                    <Linkify text={displayText} />
                                    {previewUrl && (
                                      <LinkPreviewCard url={previewUrl} />
                                    )}
                                  </div>
                                  {canTranslate && translatedDiffers && (
                                    <button
                                      className="chat-translate-note"
                                      onClick={() => toggleShowOriginal(msgKey)}
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
                                      onClick={() => toggleShowOriginal(msgKey)}
                                      type="button"
                                    >
                                      {showSelfInLang
                                        ? 'Show sent message'
                                        : `Sent in ${translation.languageName(selfSourceLang)} · ${selfExact ? 'Show original' : `Show in ${translation.languageName(targetLang)}`}`}
                                    </button>
                                  )}
                                  <span className="chat-bubble-time">
                                    {formatTime(item.msg.timestamp)}
                                  </span>
                                </div>
                                <div className="chat-msg-actions">
                                  <button
                                    className="chat-msg-action-btn hover-fx"
                                    onClick={() => handleReply(item.msg)}
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
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Input bar */}
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
                    aria-label={`Message ${active}`}
                    autoComplete="off"
                    className="chat-input-field"
                    data-lpignore="true"
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                    placeholder={
                      replyTranslate
                        ? `Reply to ${active} in their language…`
                        : `Message ${active}…`
                    }
                    ref={inputRef}
                    type="text"
                    value={message}
                  />
                  <button
                    className="chat-send-btn hover-fx"
                    disabled={!active || !message.trim()}
                    onClick={sendReply}
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
                <MessageSquare
                  size={32}
                  strokeWidth={1.25}
                />
                <h2>Your conversations start here</h2>
                <p>
                  Choose a person from the list, or start a new conversation.
                </p>
                <SendMessageModal
                  centered
                  initiateConversation={initiateConversation}
                  size="small"
                  trigger={
                    <button
                      className="chat-start-btn hover-fx"
                      type="button"
                    >
                      New Conversation
                    </button>
                  }
                />
              </div>
            )}
          </div>
        </div>
      </CommunityWorkspace>

      <ContextMenu
        friends={friends}
        menu={contextMenu}
        onAddFriend={handleAddFriend}
        onBrowse={handleBrowseFiles}
      />
    </>
  );
};

export default withRouter(Chat);
