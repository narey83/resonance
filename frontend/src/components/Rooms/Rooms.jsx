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
import { activeRoomKey } from '../../config';
import * as prefs from '../../lib/prefs';
import * as rooms from '../../lib/rooms';
import * as translation from '../../lib/translation';
import { parseUtcDate } from '../../lib/util';
import { groupByDate } from '../Chat/chatUtils';
import EmojiPickerButton from '../Shared/EmojiPickerButton';
import PlaceholderSegment from '../Shared/PlaceholderSegment';
import UsernameLink from '../Shared/UsernameLink';
import RoomMenu from './RoomMenu';
import RoomUserList from './RoomUserList';
import React, { Component, createRef } from 'react';
import { withRouter } from 'react-router-dom';
import {
  Button,
  Card,
  Dimmer,
  Icon,
  Input,
  List,
  Loader,
  Portal,
  Ref,
  Segment,
} from 'semantic-ui-react';

const roomMessageKey = (message) =>
  `${message.username}|${message.timestamp}|${message.message}`;

const translatePrefKey = (roomName) => `resonance:roomTranslate:${roomName}`;
const replyPrefKey = (roomName) => `resonance:roomReply:${roomName}`;

const baseLang = (code) => (code || '').toUpperCase().split('-')[0];

const initialState = {
  active: '',
  autoTranslate: false,
  contextMenu: {
    message: null,
    open: false,
    x: 0,
    y: 0,
  },
  intervals: {
    messages: undefined,
    rooms: undefined,
  },
  joined: [],
  loading: false,
  message: '',
  replyTranslate: false,
  room: {
    messages: [],
    users: [],
  },
  showOriginal: [],
  targetLang: 'EN',
  translateEnabled: false,
  translations: {},
};

const RoomMessageHistory = React.memo(
  ({
    autoTranslate,
    formatTimestamp,
    messages,
    onHandleContextMenu,
    onToggleOriginal,
    showOriginal,
    targetLang,
    translateEnabled,
    translations,
  }) => {
    const groups = groupByDate(messages);
    return (
      <>
        {groups.map((group) => (
          <React.Fragment key={group.label}>
            <div className="chat-date-sep">
              <span>{group.label}</span>
            </div>
            {group.messages.map((message) => {
              const key = roomMessageKey(message);
              const tr = translations[key];
              const canTranslate =
                translateEnabled && autoTranslate && !message.self;
              const translatedDiffers =
                Boolean(tr?.text) &&
                Boolean(tr?.detectedSourceLanguage) &&
                tr.detectedSourceLanguage.toUpperCase().split('-')[0] !==
                  targetLang.toUpperCase();
              const viewingOriginal = showOriginal.includes(key);
              const showTranslated =
                canTranslate && translatedDiffers && !viewingOriginal;
              // Your own message shown in your language: exact original if we
              // captured it at send time, else a back-translation of the sent text.
              const captured = message.self
                ? translation.recallOutgoing(message.message)
                : null;
              const backTranslation =
                message.self &&
                !captured &&
                Boolean(tr?.text) &&
                Boolean(tr?.detectedSourceLanguage) &&
                tr.detectedSourceLanguage.toUpperCase().split('-')[0] !==
                  targetLang.toUpperCase()
                  ? tr
                  : null;
              const selfForeign =
                (Boolean(captured) && captured.original !== message.message) ||
                Boolean(backTranslation);
              const selfExact = Boolean(captured);
              const selfInLang = captured
                ? captured.original
                : backTranslation?.text;
              const selfSourceLang = captured
                ? captured.lang
                : backTranslation?.detectedSourceLanguage;
              const showSelfInLang = selfForeign && viewingOriginal;
              return (
                <div
                  key={`${message.timestamp}+${message.message}`}
                  onContextMenu={(clickEvent) =>
                    onHandleContextMenu(clickEvent, message)
                  }
                >
                  <List.Content
                    className={`room-message ${message.self ? 'room-message-self' : ''}`}
                  >
                    <span className="room-message-time">
                      {formatTimestamp(message.timestamp)}
                    </span>
                    <UsernameLink
                      className="room-message-name"
                      username={message.username}
                    />
                    <span className="room-message-name-sep">: </span>
                    <span className="room-message-message">
                      {message.self
                        ? showSelfInLang
                          ? selfInLang
                          : message.message
                        : showTranslated
                          ? tr.text
                          : message.message}
                    </span>
                    {canTranslate && translatedDiffers && (
                      <button
                        className="chat-translate-note room-translate-note"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleOriginal(key);
                        }}
                        type="button"
                      >
                        {showTranslated
                          ? `translated from ${translation.languageName(tr.detectedSourceLanguage)} · show original`
                          : 'show translation'}
                      </button>
                    )}
                    {selfForeign && (
                      <button
                        className="chat-translate-note room-translate-note"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleOriginal(key);
                        }}
                        type="button"
                      >
                        {showSelfInLang
                          ? 'show sent message'
                          : `sent in ${translation.languageName(selfSourceLang)} · ${selfExact ? 'show original' : `show in ${translation.languageName(targetLang)}`}`}
                      </button>
                    )}
                  </List.Content>
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <List.Content id="room-history-scroll-anchor" />
      </>
    );
  },
);

RoomMessageHistory.displayName = 'RoomMessageHistory';

class Rooms extends Component {
  constructor(props) {
    super(props);

    this.state = initialState;
  }

  componentDidMount() {
    this.setState(
      {
        active: sessionStorage.getItem(activeRoomKey) || '',
        intervals: {
          messages: window.setInterval(this.fetchActiveRoom, 1_000),
          rooms: window.setInterval(this.fetchJoinedRooms, 500),
        },
      },
      async () => {
        await this.fetchJoinedRooms();
        this.selectRoom(this.state.active || this.getFirstRoom());
        document.addEventListener('click', this.handleCloseContextMenu);
      },
    );

    translation
      .getStatus()
      .then((status) => {
        if (status) {
          this.setState({
            targetLang: status.defaultTargetLanguage || 'EN',
            translateEnabled: status.enabled,
          });
        }
      })
      .catch(() => {});
  }

  componentWillUnmount() {
    const { messages: messagesInterval, rooms: roomsInterval } =
      this.state.intervals;

    clearInterval(roomsInterval);
    clearInterval(messagesInterval);

    document.removeEventListener('click', this.handleCloseContextMenu);

    this.setState({ intervals: initialState.intervals });
  }

  listRef = createRef();

  messageRef = undefined;

  getFirstRoom = () => {
    return this.state.joined.length > 0 ? this.state.joined[0] : '';
  };

  fetchJoinedRooms = async () => {
    const joined = await rooms.getJoined();
    this.setState(
      {
        joined,
      },
      () => {
        if (!this.state.joined.includes(this.state.active)) {
          this.selectRoom(this.getFirstRoom());
        }
      },
    );
  };

  fetchActiveRoom = async () => {
    const { active } = this.state;

    if (active.length === 0) return;

    const messages = await rooms.getMessages({ roomName: active });
    const users = await rooms.getUsers({ roomName: active });

    this.setState(
      {
        room: {
          messages,
          users,
        },
      },
      () => this.translatePending(),
    );
  };

  translatePending = async () => {
    const {
      active,
      autoTranslate,
      room,
      targetLang,
      translateEnabled,
      translations,
    } = this.state;

    if (!translateEnabled || !autoTranslate || !active) return;

    const pending = (room.messages || []).filter(
      (m) =>
        m.message &&
        m.message.trim() &&
        !(roomMessageKey(m) in translations) &&
        // incoming messages, plus your own sends we didn't capture an original for
        (!m.self || !translation.recallOutgoing(m.message)),
    );

    if (pending.length === 0) return;

    try {
      const results = await translation.translate({
        targetLanguage: targetLang,
        texts: pending.map((m) => m.message),
      });

      this.setState((previousState) => {
        const next = { ...previousState.translations };
        for (const [index, m] of pending.entries()) {
          next[roomMessageKey(m)] = results[index];
        }

        return { translations: next };
      });
    } catch {
      // Translation is best-effort; leave the originals in place on failure.
    }
  };

  toggleAutoTranslate = () => {
    this.setState(
      (previousState) => {
        const next = !previousState.autoTranslate;
        if (previousState.active) {
          prefs.set(translatePrefKey(previousState.active), next);
        }

        return { autoTranslate: next };
      },
      () => this.translatePending(),
    );
  };

  handleToggleOriginal = (key) => {
    this.setState((previousState) => {
      const has = previousState.showOriginal.includes(key);
      return {
        showOriginal: has
          ? previousState.showOriginal.filter((k) => k !== key)
          : [...previousState.showOriginal, key],
      };
    });
  };

  toggleReplyTranslate = () => {
    this.setState((previousState) => {
      const next = !previousState.replyTranslate;
      if (previousState.active) {
        prefs.set(replyPrefKey(previousState.active), next);
      }

      return { replyTranslate: next };
    });
  };

  // Resolve the language to translate an outgoing reply into: the most recent
  // other-user message's detected language (from cache, or probed on demand).
  resolveReplyLang = async () => {
    const { room, targetLang, translations } = this.state;
    const msgs = room.messages || [];

    for (let index = msgs.length - 1; index >= 0; index--) {
      const m = msgs[index];
      if (m.self === true || !m.message?.trim()) continue;

      const cached = translations[roomMessageKey(m)];
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
  };

  selectRoom = async (roomName) => {
    this.setState(
      (previousState) => ({
        active: roomName,
        autoTranslate: roomName
          ? Boolean(prefs.get(translatePrefKey(roomName), false))
          : false,
        replyTranslate: roomName
          ? Boolean(prefs.get(replyPrefKey(roomName), false))
          : false,
        loading: true,
        message: previousState.active === roomName ? previousState.message : '',
        room: initialState.room,
      }),
      async () => {
        const { active } = this.state;

        sessionStorage.setItem(activeRoomKey, active);

        await this.fetchActiveRoom();
        this.setState({ loading: false }, () => {
          try {
            this.listRef.current.lastChild.scrollIntoView();
          } catch {
            // no-op
          }

          try {
            this.messageRef.current.focus();
          } catch {
            // no-op
          }
        });
      },
    );
  };

  joinRoom = async (roomName) => {
    await rooms.join({ roomName });
    await this.fetchJoinedRooms();
    this.selectRoom(roomName);
  };

  leaveRoom = async (roomName) => {
    await rooms.leave({ roomName });
    await this.fetchJoinedRooms();
    this.selectRoom(this.getFirstRoom());
  };

  validInput = () =>
    (this.state.active || '').length > 0 &&
    (this.state.message || '').length > 0;

  focusInput = () => {
    this.messageRef.current.focus();
  };

  formatTimestamp = (timestamp) => {
    const date = parseUtcDate(timestamp);
    const dtfUS = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: '2-digit',
    });

    return dtfUS.format(date);
  };

  sendMessage = async () => {
    const { active, message, replyTranslate, targetLang, translateEnabled } =
      this.state;

    if (!this.validInput()) {
      return;
    }

    let toSend = message;
    if (translateEnabled && replyTranslate) {
      const lang = await this.resolveReplyLang();
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
          // fall back to sending the original text
        }
      }
    }

    await rooms.sendMessage({ message: toSend, roomName: active });
    this.setState({ message: '' });
  };

  handleEmojiSelect = (emoji) => {
    const input = this.messageRef?.current;
    const { message } = this.state;
    const start = input?.selectionStart ?? message.length;
    const end = input?.selectionEnd ?? message.length;

    this.setState(
      { message: message.slice(0, start) + emoji + message.slice(end) },
      () => {
        if (!input) return;
        input.focus();
        const cursor = start + emoji.length;
        input.setSelectionRange(cursor, cursor);
      },
    );
  };

  handleContextMenu = (clickEvent, message) => {
    clickEvent.preventDefault();
    this.setState({
      contextMenu: {
        message,
        open: true,
        x: clickEvent.pageX,
        y: clickEvent.pageY,
      },
    });
  };

  handleCloseContextMenu = () => {
    this.setState((previousState) => ({
      contextMenu: {
        ...previousState.contextMenu,
        open: false,
      },
    }));
  };

  handleReply = () => {
    this.setState(
      (previousState) => ({
        message: `[${previousState.contextMenu.message.username}] ${previousState.contextMenu.message.message} --> `,
      }),
      () => this.focusInput(),
    );
  };

  handleUserProfile = () => {
    this.props.history.push('/users', {
      user: this.state.contextMenu.message.username,
    });
  };

  handleBrowseShares = () => {
    this.props.history.push('/browse', {
      user: this.state.contextMenu.message.username,
    });
  };

  renderContextMenu() {
    const { contextMenu } = this.state;
    return (
      <Portal open={contextMenu.open}>
        <div
          className="ui vertical buttons popup-menu"
          style={{
            left: contextMenu.x,
            maxHeight: `calc(100vh - ${contextMenu.y}px)`,
            top: contextMenu.y,
          }}
        >
          <Button
            className="ui compact button popup-option"
            onClick={this.handleReply}
          >
            Reply
          </Button>
          <Button
            className="ui compact button popup-option"
            onClick={this.handleUserProfile}
          >
            User Profile
          </Button>
          <Button
            className="ui compact button popup-option"
            onClick={this.handleBrowseShares}
          >
            Browse Shares
          </Button>
        </div>
      </Portal>
    );
  }

  render() {
    const { active = [], joined = [], loading, room } = this.state;

    return (
      <div className="rooms">
        <Segment
          className="rooms-segment"
          raised
        >
          <div className="rooms-segment-icon">
            <Icon
              name="comments"
              size="big"
            />
          </div>
          <RoomMenu
            active={active}
            joinRoom={this.joinRoom}
            joined={joined}
            onRoomChange={(name) => this.selectRoom(name)}
          />
        </Segment>
        {active?.length === 0 ? (
          <PlaceholderSegment
            caption="No rooms to display"
            icon="comments"
          />
        ) : (
          <Card
            className="room-active-card"
            raised
          >
            <Card.Content onClick={() => this.focusInput()}>
              <Card.Header>
                <Icon
                  color="green"
                  name="circle"
                />
                {active}
                {this.state.translateEnabled && (
                  <Icon
                    className="room-translate-button"
                    color={this.state.autoTranslate ? 'blue' : 'grey'}
                    link
                    name="language"
                    onClick={(event) => {
                      event.stopPropagation();
                      this.toggleAutoTranslate();
                    }}
                    title={
                      this.state.autoTranslate
                        ? `Auto-translating to ${translation.languageName(this.state.targetLang)}`
                        : 'Auto-translate messages'
                    }
                  />
                )}
                <Icon
                  className="close-button"
                  color="red"
                  link
                  name="close"
                  onClick={() => this.leaveRoom(active)}
                />
              </Card.Header>
              <div className="room">
                {loading ? (
                  <Dimmer
                    active
                    inverted
                  >
                    <Loader inverted />
                  </Dimmer>
                ) : (
                  <>
                    <Segment.Group>
                      <Segment className="room-history">
                        <Ref innerRef={this.listRef}>
                          <List>
                            <RoomMessageHistory
                              autoTranslate={this.state.autoTranslate}
                              formatTimestamp={this.formatTimestamp}
                              messages={room.messages}
                              onHandleContextMenu={this.handleContextMenu}
                              onToggleOriginal={this.handleToggleOriginal}
                              showOriginal={this.state.showOriginal}
                              targetLang={this.state.targetLang}
                              translateEnabled={this.state.translateEnabled}
                              translations={this.state.translations}
                            />
                          </List>
                        </Ref>
                      </Segment>
                      <Segment className="room-input">
                        <EmojiPickerButton onSelect={this.handleEmojiSelect} />
                        {this.state.translateEnabled && (
                          <Icon
                            className="room-reply-toggle"
                            color={this.state.replyTranslate ? 'blue' : 'grey'}
                            link
                            name="globe"
                            onClick={() => this.toggleReplyTranslate()}
                            title={
                              this.state.replyTranslate
                                ? "Reply translation on — your message is translated into the other user's language before sending"
                                : 'Reply in their language'
                            }
                          />
                        )}
                        <Input
                          action={{
                            className: 'room-message-button',
                            disabled: !this.validInput(),
                            icon: (
                              <Icon
                                color="green"
                                name="send"
                              />
                            ),
                            onClick: this.sendMessage,
                          }}
                          fluid
                          input={
                            <input
                              autoComplete="off"
                              data-lpignore="true"
                              id="room-message-input"
                              onChange={(event) =>
                                this.setState({ message: event.target.value })
                              }
                              type="text"
                              value={this.state.message}
                            />
                          }
                          onKeyUp={(event) =>
                            event.key === 'Enter' ? this.sendMessage() : ''
                          }
                          ref={(input) =>
                            (this.messageRef = input && input.inputRef)
                          }
                          transparent
                        />
                      </Segment>
                    </Segment.Group>
                    <Segment className="room-users">
                      <RoomUserList users={room.users} />
                    </Segment>
                  </>
                )}
              </div>
            </Card.Content>
          </Card>
        )}
        {this.renderContextMenu()}
      </div>
    );
  }
}

export default withRouter(Rooms);
