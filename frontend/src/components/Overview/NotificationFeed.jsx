import { urlBase } from '../../config';
import { getFileName, parseUtcDate } from '../../lib/util';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  MessageCircle,
  Zap,
  ZapOff,
} from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const FILTERS = ['All', 'Transfers', 'Messages', 'System'];

const isTransfer = (type) =>
  type?.includes('Download') || type?.includes('Upload');
const isMessage = (type) => type?.includes('Message');
const isSystem = (type) => type?.includes('Client');

const EventIcon = ({ type }) => {
  if (type === 'DownloadFileComplete' || type === 'DownloadDirectoryComplete')
    return (
      <ArrowDown
        className="event-icon download"
        size={13}
        strokeWidth={1.75}
      />
    );
  if (type === 'UploadFileComplete')
    return (
      <ArrowUp
        className="event-icon upload"
        size={13}
        strokeWidth={1.75}
      />
    );
  if (type === 'PrivateMessageReceived' || type === 'RoomMessageReceived')
    return (
      <MessageCircle
        className="event-icon message"
        size={13}
        strokeWidth={1.75}
      />
    );
  if (type === 'SoulseekClientConnected')
    return (
      <Zap
        className="event-icon system connected"
        size={13}
        strokeWidth={1.75}
      />
    );
  if (type === 'SoulseekClientDisconnected')
    return (
      <ZapOff
        className="event-icon system disconnected"
        size={13}
        strokeWidth={1.75}
      />
    );
  return (
    <Bell
      className="event-icon"
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

const EVENT_FORMATTERS = {
  DownloadDirectoryComplete: (data) => ({
    link: null,
    sub: `from ${data.username ?? ''}`,
    text: data.remoteDirectoryName ?? 'Directory complete',
  }),
  DownloadFileComplete: (data) => ({
    link: null,
    sub: `from ${data.transfer?.username ?? ''}`,
    text: getFileName(data.remoteFilename ?? ''),
  }),
  PrivateMessageReceived: (data) => ({
    link: `${urlBase}/chat`,
    sub: String(data.message?.message ?? '').slice(0, 60),
    text: data.message?.username ?? 'Message',
  }),
  RoomMessageReceived: (data) => ({
    link: `${urlBase}/rooms`,
    sub: String(data.message?.message ?? '').slice(0, 60),
    text: `${data.message?.username ?? ''} in ${data.message?.roomName ?? ''}`,
  }),
  SoulseekClientConnected: () => ({
    link: null,
    sub: '',
    text: 'Connected to Soulseek',
  }),
  SoulseekClientDisconnected: (data) => ({
    link: null,
    sub: String(data.message ?? '').slice(0, 60),
    text: 'Disconnected from Soulseek',
  }),
  UploadFileComplete: (data) => ({
    link: null,
    sub: `to ${data.transfer?.username ?? ''}`,
    text: getFileName(data.remoteFilename ?? ''),
  }),
};

const formatEvent = (event) => {
  const data = parseData(event.data);
  const formatter = EVENT_FORMATTERS[event.type];
  return formatter
    ? formatter(data)
    : { link: null, sub: '', text: event.type ?? 'Event' };
};

const formatTime = (ts) =>
  parseUtcDate(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

const NotificationFeed = ({ events }) => {
  const [filter, setFilter] = useState('All');
  const [dismissed, setDismissed] = useState(new Set());

  const list = Array.isArray(events) ? events : [];

  const visible = list.filter((item) => {
    if (dismissed.has(item.id)) return false;
    if (filter === 'Transfers') return isTransfer(item.type);
    if (filter === 'Messages') return isMessage(item.type);
    if (filter === 'System') return isSystem(item.type);
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
                <div className="notif-time">{formatTime(event.timestamp)}</div>
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
