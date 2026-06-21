import './Chat.css';
import '../Search/Search.css';
import { activeChatKey } from '../../config';
import * as chat from '../../lib/chat';
import * as prefs from '../../lib/prefs';
import {
  avatarColor,
  avatarInitial,
  formatTime,
  groupByDate,
} from './chatUtils';
import SendMessageModal from './SendMessageModal';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageSquare, Plus, Send, X } from 'lucide-react';
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

// ── Constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH_KEY = 'resonance-chat-sidebar-width';
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 420;

// ── Main component ────────────────────────────────────────────────────────────

const Chat = ({ history, location }) => {
  const [active, setActive] = useState('');
  const [conversations, setConversations] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [friends, setFriends] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(prefs.get(SIDEBAR_WIDTH_KEY, 256));
    return Number.isFinite(saved) ? saved : 256;
  });

  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const dividerMoveRef = useRef(null);
  const intervalRef = useRef(null);
  const activeRef = useRef('');

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    const element = chatScrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  // ── Fetch conversations ──────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
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
      }

      const activeDetail = await chat.get({ username: currentActive });
      convMap = { ...convMap, [currentActive]: activeDetail };
    }

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
  }, []);

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
        const full = await chat.get({ username });
        setConversations((previous) => ({ ...previous, [username]: full }));
      } finally {
        setLoading(false);
        setTimeout(scrollToBottom, 50);
        inputRef.current?.focus();
      }
    },
    [scrollToBottom],
  );

  // ── Mount ────────────────────────────────────────────────────────────────────

  useEffect(() => {
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

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener('click', onDocumentClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const sendReply = useCallback(async () => {
    if (!active || !message.trim()) return;
    await chat.send({ username: active, message });
    setMessage('');
    fetchConversations();
  }, [active, fetchConversations, message]);

  const deleteConversation = useCallback(
    async (username) => {
      try {
        await chat.remove({ username });
      } catch {
        /* local-only conversation, no server record */
      }

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

  const convList = Object.values(conversations);
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

  useEffect(() => {
    const element = chatScrollRef.current;
    if (element && flatItems.length > 0) {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    }
  }, [flatItems.length, active]);

  return (
    <>
      <div
        className="sr-root"
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
              Messages
            </span>
            <SendMessageModal
              centered
              initiateConversation={initiateConversation}
              size="small"
              trigger={
                <button
                  className="sr-create-btn"
                  title="New conversation"
                  type="button"
                >
                  <Plus size={15} />
                </button>
              }
            />
          </div>

          <div className="sr-search-list">
            {convList.length === 0 ? (
              <div className="sr-search-list-empty">No conversations yet</div>
            ) : (
              convList.map((conv) => (
                <div
                  className={`chat-conv-item sr-search-item${active === conv.username ? ' sr-search-item--active' : ''}`}
                  key={conv.username}
                  onClick={() => selectConversation(conv.username)}
                  onContextMenu={(e) => openContextMenu(e, conv.username)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && selectConversation(conv.username)
                  }
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
                    <span className="chat-conv-badge">
                      {conv.unAcknowledgedMessageCount}
                    </span>
                  )}
                  <button
                    className="chat-conv-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.username);
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
              ))
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
                  <span className="chat-header-name">{active}</span>
                </div>
                <div className="sr-detail-header-actions">
                  <button
                    className="sr-btn sr-btn--danger"
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
                                  {item.msg.message}
                                </div>
                                <span className="chat-bubble-time">
                                  {formatTime(item.msg.timestamp)}
                                </span>
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
                <input
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
                  placeholder={`Message ${active}…`}
                  ref={inputRef}
                  type="text"
                  value={message}
                />
                <button
                  className="chat-send-btn"
                  disabled={!active || !message.trim()}
                  onClick={sendReply}
                  title="Send"
                  type="button"
                >
                  <Send
                    size={16}
                    strokeWidth={2}
                  />
                </button>
              </div>
            </div>
          ) : (
            <div className="sr-empty">
              <MessageSquare
                size={32}
                strokeWidth={1.25}
              />
              <p>Select a conversation or start a new one</p>
              <SendMessageModal
                centered
                initiateConversation={initiateConversation}
                size="small"
                trigger={
                  <button
                    className="chat-start-btn"
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
