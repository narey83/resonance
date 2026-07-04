// <copyright file="UserChatTab.jsx" company="John Narey">
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

import '../Chat/Chat.css';
import '../Search/Search.css';
import * as chat from '../../lib/chat';
import {
  avatarColor,
  avatarInitial,
  formatTime,
  groupByDate,
} from '../Chat/chatUtils';
import { Send } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const UserChatTab = ({ username }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const intervalRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const fetchConversation = useCallback(
    async ({ showLoading } = {}) => {
      if (!username) return;
      if (showLoading) setLoading(true);
      try {
        const conv = await chat.get({ username });
        setMessages(conv?.messages ?? []);
        if (conv?.hasUnAcknowledgedMessages) {
          chat.acknowledge({ username }).catch(() => {});
        }
      } catch {
        setMessages([]);
      } finally {
        if (showLoading) {
          setLoading(false);
          setTimeout(scrollToBottom, 50);
        }
      }
    },
    [scrollToBottom, username],
  );

  useEffect(() => {
    if (!username) return undefined;
    fetchConversation({ showLoading: true });
    setTimeout(() => inputRef.current?.focus(), 50);
    intervalRef.current = window.setInterval(fetchConversation, 5_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchConversation, username]);

  const sendReply = useCallback(async () => {
    const trimmed = message.trim();
    if (!username || !trimmed) return;
    setMessage('');
    try {
      await chat.send({ username, message: trimmed });
      await fetchConversation();
      setTimeout(scrollToBottom, 50);
    } catch {
      setMessage(trimmed);
    }
  }, [fetchConversation, message, scrollToBottom, username]);

  const groups = groupByDate(messages);

  return (
    <div className="user-chat-tab">
      <div
        className="chat-messages user-chat-messages"
        ref={scrollRef}
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
              style={{ background: avatarColor(username) }}
            >
              {avatarInitial(username)}
            </div>
            <p>
              Start a conversation with <strong>{username}</strong>
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <React.Fragment key={group.label}>
              <div className="chat-date-sep">
                <span>{group.label}</span>
              </div>
              {group.messages.map((msg, index) => {
                const isSelf = msg.direction === 'Out';
                const previous = group.messages[index - 1];
                const showAvatar =
                  !isSelf && (!previous || previous.direction === 'Out');
                return (
                  <div
                    className={`chat-msg-row${isSelf ? ' chat-msg-row--self' : ''}`}
                    // eslint-disable-next-line react/no-array-index-key
                    key={`${msg.timestamp}-${index}`}
                  >
                    {!isSelf && (
                      <div
                        className={`chat-bubble-avatar${showAvatar ? '' : ' chat-bubble-avatar--ghost'}`}
                        style={{
                          background: avatarColor(msg.username || username),
                        }}
                      >
                        {showAvatar
                          ? avatarInitial(msg.username || username)
                          : ''}
                      </div>
                    )}
                    <div className="chat-bubble-col">
                      <div
                        className={`chat-bubble${isSelf ? ' chat-bubble--self' : ' chat-bubble--other'}`}
                      >
                        {msg.message}
                      </div>
                      <span className="chat-bubble-time">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))
        )}
      </div>

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
          placeholder={`Message ${username}…`}
          ref={inputRef}
          type="text"
          value={message}
        />
        <button
          className="chat-send-btn"
          disabled={!message.trim()}
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
  );
};

export default UserChatTab;
