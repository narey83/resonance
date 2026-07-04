// <copyright file="App.jsx" company="JP Dillingham">
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

import 'react-toastify/dist/ReactToastify.css';
import './App.css';
import { urlBase } from '../config';
import {
  LibraryActivityProvider,
  useLibraryActivity,
} from '../context/LibraryActivityContext';
import { PlayerProvider, usePlayer } from '../context/PlayerContext';
import { TagEditActivityProvider } from '../context/TagEditActivityContext';
import * as chatAPI from '../lib/chat';
import { emitPrivateMessage } from '../lib/chatEvents';
import * as eventsAPI from '../lib/events';
import { createApplicationHubConnection } from '../lib/hubFactory';
import * as networkAPI from '../lib/network';
import * as prefs from '../lib/prefs';
import * as roomsAPI from '../lib/rooms';
import { connect, disconnect } from '../lib/server';
import * as session from '../lib/session';
import { playMessageReceived } from '../lib/sound';
import { getSessionId, isAdmin, isPassthroughEnabled } from '../lib/token';
import * as transfersAPI from '../lib/transfers';
import { parseUtcDate } from '../lib/util';
import AppContext from './AppContext';
import Browse from './Browse/Browse';
import Chat from './Chat/Chat';
import ConnectionScreen from './ConnectionScreen';
import Converter from './Converter/Converter';
import Duplicates from './Duplicates/Duplicates';
import Library from './Library/Library';
import LoginForm from './LoginForm';
import MapPage from './Map';
import MediaPlayer from './MediaPlayer';
import MetadataLookupWatcher from './MetadataLookup/MetadataLookupWatcher';
import NotificationCentre from './Notifications/NotificationCentre';
import Overview from './Overview';
import StatusStrip from './Overview/StatusStrip';
import PublicMixtape from './PublicMixtape/PublicMixtape';
import QueuePanel from './Queue/QueuePanel';
import Rooms from './Rooms/Rooms';
import Searches from './Search/Searches';
import Setup from './Setup';
import ResonanceMark from './Shared/ResonanceMark';
import DatabaseViewer from './System/DatabaseViewer';
import System from './System/System';
import Tags from './Tags/Tags';
import TrackAnalysis from './TrackAnalysis/TrackAnalysis';
import Transfers from './Transfers/Transfers';
import Users from './Users/Users';
import YtDlp from './YtDlp/YtDlp';
import {
  AlertCircle,
  AudioLines,
  Bell,
  Copy,
  Download,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  Library as LibraryIcon,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Tag,
  Upload,
  Users as UsersIcon,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { Link, Redirect, Route, Switch, withRouter } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { Button, Loader, Modal } from 'semantic-ui-react';

// ── Small always-rendered helpers ────────────────────────────────────────────

const PlayTracker = () => {
  const { track } = usePlayer();
  const activity = useLibraryActivity();
  useEffect(() => {
    if (track?.path) activity?.recordPlay(track.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.path]);
  return null;
};

const AppQueuePanel = () => {
  const { queuePanelOpen, toggleQueuePanel, track } = usePlayer();
  if (!queuePanelOpen || !track) return null;
  return <QueuePanel onClose={toggleQueuePanel} />;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const THEMES = ['light', 'amoled'];
const THEME_LABELS = { amoled: 'AMOLED', light: 'Light' };
const ALL_THEME_CLASSES = ['amoled', 'dark', 'dim'];

const INIT_MAX_ATTEMPTS = 30;

const DEFAULT_NOTIFICATION_SETTINGS = {
  privateMessage: true,
  browsed: true,
  roomMention: true,
};

const loadNotificationSettings = () => {
  const saved = prefs.get('resonance-notification-settings', null);
  if (saved && typeof saved === 'object')
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...saved };
  return { ...DEFAULT_NOTIFICATION_SETTINGS };
};

const parseEventData = (raw) => {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};

const formatEventNotification = (record, lastReadAt) => {
  const d = parseEventData(record.data);
  let message;
  let type;
  switch (record.type) {
    case 'PrivateMessageReceived': {
      const text = d.message?.message || '';
      const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
      type = 'privateMessage';
      message = `Private message from ${d.message?.username || '?'}: ${preview}`;
      break;
    }

    case 'Browsed':
      type = 'browsed';
      message = `${d.username || '?'} browsed your files`;
      break;
    case 'RoomMention': {
      const text = d.message || '';
      const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
      type = 'roomMention';
      message = `${d.username || '?'} mentioned you in ${d.roomName || '?'}: ${preview}`;
      break;
    }

    default:
      return null;
  }

  const isRead = lastReadAt
    ? parseUtcDate(record.timestamp) <= parseUtcDate(lastReadAt)
    : false;
  return {
    id: record.id,
    type,
    message,
    timestamp: record.timestamp,
    read: isRead,
  };
};

const flattenTransfers = (groups) =>
  (groups ?? []).flatMap((g) =>
    (g.directories ?? []).flatMap((d) => d.files ?? []),
  );

// ── Nav helpers ───────────────────────────────────────────────────────────────

const NavItem = ({ active, badge, icon: NavIcon, label, onClick, to }) => {
  const className = `app-nav-item${active ? ' active' : ''}`;
  const badgeElement =
    badge > 0 ? <span className="app-nav-badge">{badge}</span> : null;
  if (to) {
    return (
      <Link
        className={className}
        title={label}
        to={to}
      >
        <span className="app-nav-icon">
          <NavIcon
            size={16}
            strokeWidth={1.75}
          />
        </span>
        <span className="app-nav-item-label">{label}</span>
        {badgeElement}
      </Link>
    );
  }

  return (
    <button
      className={className}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="app-nav-icon">
        <NavIcon
          size={16}
          strokeWidth={1.75}
        />
      </span>
      <span className="app-nav-item-label">{label}</span>
      {badgeElement}
    </button>
  );
};

const getPage = () => {
  const segment = window.location.pathname
    .replace(urlBase, '')
    .split('/')
    .find(Boolean);
  return segment || 'overview';
};

// ── App ───────────────────────────────────────────────────────────────────────

const App = () => {
  // ── Auth / connection state ─────────────────────────────────────────────────
  // Do NOT initialise from storage — hub must not start until the session is
  // confirmed valid by doInit (mirrors the original class component behaviour).
  // isPassthroughEnabled is the only safe exception since it needs no JWT.
  const [isLoggedIn, setIsLoggedIn] = useState(() => isPassthroughEnabled());
  // Single source of truth for backend connectivity.
  // 'connecting' = initial REST init failing; 'reconnecting' = established
  // session lost its hub connection.
  const [connection, setConnection] = useState({
    attempt: 0,
    since: null,
    status: 'online',
  });
  const [initialized, setInitialized] = useState(false);
  const [setup, setSetup] = useState({
    error: undefined,
    pending: false,
    required: null,
  });
  const [login, setLogin] = useState({ error: undefined, pending: false });

  // ── Hub-derived state ───────────────────────────────────────────────────────
  const [applicationOptions, setApplicationOptions] = useState({});
  const [applicationState, setApplicationState] = useState({});

  // ── UI state ────────────────────────────────────────────────────────────────
  const [chatUnread, setChatUnread] = useState(0);
  const [downloadCount, setDownloadCount] = useState(0);
  const [downloads, setDownloads] = useState([]);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    const v = prefs.get('resonance-nav-collapsed', false);
    return v === true || v === 'true';
  });
  const [networkInfo, setNetworkInfo] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(
    loadNotificationSettings,
  );
  const [roomUnread, setRoomUnread] = useState(0);
  const [theme, setTheme] = useState(
    () =>
      prefs.get('resonance-theme', null) ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'),
  );
  const [uploadCount, setUploadCount] = useState(0);
  const [uploads, setUploads] = useState([]);

  // ── Memoised derived values ───────────────────────────────────────────────────
  const appContextValue = useMemo(
    () => ({
      isAdmin: isAdmin(),
      options: applicationOptions,
      state: applicationState,
    }),
    [applicationOptions, applicationState],
  );

  // ── Refs (mutable, don't trigger re-renders) ────────────────────────────────
  const roomBaselines = useRef({});
  const initAttemptRef = useRef(0);
  // "Retry now" hooks for the connection screen/overlay.
  const retryInitRef = useRef(null);
  const hubRetryRef = useRef(null);
  // Keep latest notificationSettings accessible inside hub handlers without
  // re-creating the hub every time settings change.
  const notifSettingsRef = useRef(notificationSettings);
  notifSettingsRef.current = notificationSettings;

  // ── addNotification (stable ref pattern) ────────────────────────────────────
  const addNotification = useCallback(
    (
      type,
      message,
      {
        skipToast = false,
        sound = false,
        toastOptions = {},
        toastType = 'info',
      } = {},
    ) => {
      if (!notifSettingsRef.current[type]) return;
      const notification = {
        id: `${Date.now()}-${Math.random()}`,
        type,
        message,
        timestamp: new Date(),
        read: false,
      };
      setNotifications((previous) => [notification, ...previous].slice(0, 100));
      if (sound) playMessageReceived();
      if (!skipToast) toast[toastType](message, toastOptions);
    },
    [],
  );

  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  // ══════════════════════════════════════════════════════════════════════════════
  // Effect 1 — One-time init: check setup state + verify session
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const doInit = async () => {
      try {
        const appInitialized = await session.getInitialized();
        if (cancelled) return;

        if (!appInitialized) {
          setSetup({ error: undefined, pending: false, required: true });
          setInitialized(true);
          setConnection({ attempt: 0, since: null, status: 'online' });
          return;
        }

        setSetup((s) => ({ ...s, required: false }));

        // Confirm the session is valid before starting the hub.
        // This prevents negotiation-401 errors from expired tokens on page load.
        if (isPassthroughEnabled()) {
          if (!cancelled) setIsLoggedIn(true);
        } else if (session.isLoggedIn()) {
          const valid = await session.check(); // interceptor handles token refresh
          if (!cancelled) setIsLoggedIn(valid);
        }

        if (!cancelled) {
          setInitialized(true);
          setConnection({ attempt: 0, since: null, status: 'online' });
        }
      } catch {
        if (cancelled) return;
        initAttemptRef.current += 1;
        setConnection((c) => ({
          attempt: initAttemptRef.current,
          since: c.since ?? new Date(),
          status: 'connecting',
        }));
        setInitialized(true);
        // Never dead-end: back off from 2s to 10s after INIT_MAX_ATTEMPTS.
        const delay =
          initAttemptRef.current < INIT_MAX_ATTEMPTS ? 2_000 : 10_000;

        timer = setTimeout(doInit, delay);
      }
    };

    retryInitRef.current = () => {
      clearTimeout(timer);
      doInit();
    };

    initAttemptRef.current = 0;
    doInit();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      retryInitRef.current = null;
    };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════════
  // Effect 2 — System-preference theme listener (only when no saved theme)
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (prefs.get('resonance-theme', null) !== null) return undefined;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
    const onDark = (e) => {
      if (e.matches) setTheme('dark');
    };

    const onLight = (e) => {
      if (e.matches) setTheme('light');
    };

    darkQuery.addEventListener('change', onDark);
    lightQuery.addEventListener('change', onLight);
    return () => {
      darkQuery.removeEventListener('change', onDark);
      lightQuery.removeEventListener('change', onLight);
    };
  }, []);

  // Cross-tab theme sync — prefs.set writes to localStorage, firing storage events in other tabs
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'resonance-theme' && e.newValue) setTheme(e.newValue);
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════════
  // Effect 3 — Hub lifecycle, tied to isLoggedIn.
  // Cleanup runs automatically on logout, re-login, or unmount.
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    // Distinguishes deliberate hub.stop() (logout, unmount, retry-now) from a
    // genuine connection loss in onclose.
    let intentionalStop = false;
    let startRetryTimer = null;
    let startAttempt = 0;

    const markReconnecting = (attempt) => {
      setConnection((c) => ({
        attempt,
        since: c.status === 'reconnecting' ? c.since : new Date(),
        status: 'reconnecting',
      }));
    };

    const hub = createApplicationHubConnection({
      onRetry: (context) => markReconnecting(context.previousRetryCount + 1),
    });

    // Manual start loop covering the two cases automatic reconnect does not:
    // a failed initial start, and onclose. Retries until it succeeds.
    const startWithRetry = async () => {
      try {
        await hub.start();
        if (intentionalStop) return;
        startAttempt = 0;

        setConnection({ attempt: 0, since: null, status: 'online' });
      } catch {
        if (intentionalStop) return;
        startAttempt += 1;
        markReconnecting(startAttempt);
        startRetryTimer = setTimeout(
          startWithRetry,
          Math.min(2 ** startAttempt * 500, 30_000),
        );
      }
    };

    let pendingState = null;
    let pendingOptions = null;
    let flushTimeout = null;
    const flushPending = () => {
      flushTimeout = null;
      unstable_batchedUpdates(() => {
        if (pendingState !== null) {
          setApplicationState(pendingState);
          pendingState = null;
        }

        if (pendingOptions !== null) {
          setApplicationOptions(pendingOptions);
          pendingOptions = null;
        }
      });
    };

    hub.on('STATE', (state) => {
      pendingState = state;
      if (!flushTimeout) flushTimeout = setTimeout(flushPending, 0);
    });
    hub.on('OPTIONS', (options) => {
      pendingOptions = options;
      if (!flushTimeout) flushTimeout = setTimeout(flushPending, 0);
    });

    hub.onreconnecting(() => {
      markReconnecting(1);
    });

    hub.onclose(() => {
      if (intentionalStop) return;
      // Automatic reconnect gave up (or the connection was force-closed);
      // fall back to the manual start loop so we never dead-end.
      markReconnecting(1);
      startWithRetry();
    });

    hub.onreconnected(() => {
      setConnection({ attempt: 0, since: null, status: 'online' });
    });

    hub.on('PRIVATE_MESSAGE', ({ message, username }) => {
      emitPrivateMessage({ message, username });
      const preview =
        message.length > 60 ? `${message.slice(0, 60)}…` : message;
      addNotificationRef.current(
        'privateMessage',
        `Private message from ${username}: ${preview}`,
        { sound: true },
      );
    });

    hub.on('BROWSED', (username) => {
      addNotificationRef.current('browsed', `${username} browsed your files`);
    });

    hub.on('ROOM_MENTION', ({ message, roomName, username }) => {
      const preview =
        message.length > 60 ? `${message.slice(0, 60)}…` : message;
      addNotificationRef.current(
        'roomMention',
        `${username} mentioned you in ${roomName}: ${preview}`,
      );
    });

    hub.on('SERVER_RESTARTING', () => {
      if (toast.isActive('connection-status')) {
        toast.update('connection-status', {
          render: 'Server is restarting...',
          type: toast.TYPE.WARNING,
          autoClose: false,
        });
      } else {
        toast.warn('Server is restarting...', {
          toastId: 'connection-status',
          autoClose: false,
        });
      }
    });

    hub.on('SERVER_READY', () => {
      if (toast.isActive('connection-status')) {
        toast.update('connection-status', {
          render: 'Server is back online',
          type: toast.TYPE.SUCCESS,
          autoClose: 4_000,
        });
      }
    });

    hub.on('SESSION_REVOKED', async (revokedIds) => {
      const mySessionId = getSessionId();
      if (mySessionId && revokedIds.includes(mySessionId)) {
        await session.logout();
        setIsLoggedIn(false);
      }
    });

    // Force an immediate attempt instead of waiting out the retry backoff.
    hubRetryRef.current = async () => {
      clearTimeout(startRetryTimer);
      intentionalStop = true;
      try {
        await hub.stop();
      } catch {
        /* ignore */
      }

      intentionalStop = false;
      startWithRetry();
    };

    startWithRetry();

    // Cleanup: hub stops when isLoggedIn becomes false (logout) or component unmounts.
    return () => {
      intentionalStop = true;
      clearTimeout(flushTimeout);
      clearTimeout(startRetryTimer);
      hubRetryRef.current = null;
      hub.stop().catch(() => {});
    };
  }, [isLoggedIn]);

  // ══════════════════════════════════════════════════════════════════════════════
  // Effect 4 — Load prefs, notifications, and network info when authenticated.
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let cancelled = false;

    const load = async () => {
      await prefs.load();

      const savedTheme = prefs.get('resonance-theme', null);
      if (!cancelled && savedTheme) setTheme(savedTheme);

      try {
        const clearedAt = localStorage.getItem(
          'resonance-notifications-cleared-at',
        );
        const lastReadAt = localStorage.getItem(
          'resonance-notifications-last-read',
        );
        const { events } = await eventsAPI.list({
          limit: 100,
          offset: 0,
          from: clearedAt || undefined,
        });
        if (!cancelled) {
          const loaded = events
            .map((e) => formatEventNotification(e, lastReadAt))
            .filter((n) => n && notifSettingsRef.current[n.type] !== false);
          setNotifications(loaded);
        }
      } catch {
        /* silently ignore */
      }
    };

    const loadNetworkInfo = async () => {
      try {
        const info = await networkAPI.getNetworkInfo();
        if (!cancelled) setNetworkInfo(info);
      } catch {
        /* silently ignore */
      }
    };

    load();
    loadNetworkInfo();
    // Poll network info so the VPN indicator reflects connect/disconnect
    // without needing a full page reload.
    const networkInterval = setInterval(loadNetworkInfo, 30_000);
    return () => {
      cancelled = true;
      clearInterval(networkInterval);
    };
  }, [isLoggedIn]);

  // ══════════════════════════════════════════════════════════════════════════════
  // Effect 5 — Transfer count polling (badge counts in nav).
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const poll = async () => {
      try {
        const [downloadGroups, uploadGroups] = await Promise.all([
          transfersAPI.getAll({ direction: 'download' }).catch(() => null),
          transfersAPI.getAll({ direction: 'upload' }).catch(() => null),
        ]);
        const countActive = (groups) => {
          if (!Array.isArray(groups)) return 0;
          return groups.reduce(
            (sum, g) =>
              sum +
              (g.directories ?? []).reduce(
                (s, d) =>
                  s +
                  (d.files ?? []).filter(
                    (f) =>
                      f.state === 'InProgress' || f.state === 'Initializing',
                  ).length,
                0,
              ),
            0,
          );
        };

        unstable_batchedUpdates(() => {
          setDownloadCount(countActive(downloadGroups));
          setDownloads(flattenTransfers(downloadGroups));
          setUploadCount(countActive(uploadGroups));
          setUploads(flattenTransfers(uploadGroups));
        });
      } catch {
        /* silently ignore */
      }
    };

    poll();
    const id = setInterval(poll, 5_000);
    return () => clearInterval(id);
  }, [isLoggedIn]);

  // ══════════════════════════════════════════════════════════════════════════════
  // Effect 6 — Chat and room unread count polling.
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const poll = async () => {
      try {
        const activePage = getPage();

        const [conversations, joinedRooms] = await Promise.all([
          chatAPI.getAll().catch(() => null),
          roomsAPI.getJoined().catch(() => null),
        ]);

        const unreadChats = Array.isArray(conversations)
          ? conversations.filter((c) => c.hasUnAcknowledgedMessages).length
          : 0;

        let unreadRooms = 0;
        if (Array.isArray(joinedRooms) && joinedRooms.length > 0) {
          const messageCounts = await Promise.all(
            joinedRooms.map(async (room) => {
              try {
                const msgs = await roomsAPI.getMessages({ roomName: room });
                return { room, count: Array.isArray(msgs) ? msgs.length : 0 };
              } catch {
                return { room, count: 0 };
              }
            }),
          );

          for (const { count, room } of messageCounts) {
            if (activePage === 'rooms' || !(room in roomBaselines.current)) {
              roomBaselines.current[room] = count;
            } else {
              unreadRooms += Math.max(0, count - roomBaselines.current[room]);
            }
          }

          for (const room of Object.keys(roomBaselines.current)) {
            if (!joinedRooms.includes(room)) delete roomBaselines.current[room];
          }
        }

        unstable_batchedUpdates(() => {
          setChatUnread(unreadChats);
          setRoomUnread(unreadRooms);
        });
      } catch {
        /* silently ignore */
      }
    };

    poll();
    const id = setInterval(poll, 5_000);
    return () => clearInterval(id);
  }, [isLoggedIn]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleLogin = useCallback(async (username, password, rememberMe) => {
    setLogin({ error: undefined, pending: true });
    try {
      await session.login({ password, rememberMe, username });
      setLogin({ error: false, pending: false });
      setIsLoggedIn(true);
    } catch (loginError) {
      setLogin({ error: loginError, pending: false });
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await session.logout();
    setIsLoggedIn(false);
    setApplicationState({});
    setApplicationOptions({});
    setLogin({ error: undefined, pending: false });
    setConnection({ attempt: 0, since: null, status: 'online' });
  }, []);

  const handleSetupComplete = useCallback(() => {
    setSetup((s) => ({ ...s, required: false }));
    setIsLoggedIn(true);
  }, []);

  const handleToggleNav = useCallback(() => {
    setNavCollapsed((previous) => {
      const next = !previous;
      prefs.set('resonance-nav-collapsed', next);
      return next;
    });
  }, []);

  const handleToggleNotificationPanel = useCallback(() => {
    setNotificationPanelOpen((previous) => {
      const opening = !previous;
      if (opening)
        localStorage.setItem(
          'resonance-notifications-last-read',
          new Date().toISOString(),
        );
      setNotifications((ns) =>
        opening ? ns.map((n) => ({ ...n, read: true })) : ns,
      );
      return opening;
    });
  }, []);

  const handleClearNotifications = useCallback(() => {
    localStorage.setItem(
      'resonance-notifications-cleared-at',
      new Date().toISOString(),
    );
    setNotifications([]);
  }, []);

  const handleNotificationSettingsChange = useCallback((key, value) => {
    setNotificationSettings((previous) => {
      const updated = { ...previous, [key]: value };
      prefs.set('resonance-notification-settings', updated);
      return updated;
    });
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme((previousTheme) => {
      const index = THEMES.indexOf(previousTheme ?? 'light');
      const newTheme = THEMES[(index + 1) % THEMES.length];
      prefs.set('resonance-theme', newTheme);
      return newTheme;
    });
  }, []);

  // ── Apply theme classes ───────────────────────────────────────────────────────
  for (const cls of ALL_THEME_CLASSES)
    document.documentElement.classList.remove(cls);
  if (theme !== 'light') document.documentElement.classList.add(theme);

  // ── Gate: full-screen screens that replace the app ───────────────────────────
  const mixtapeMatch = window.location.pathname.match(
    new RegExp(
      `^${urlBase.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')}/mixtape/([^/]+)/?$`,
    ),
  );
  if (mixtapeMatch) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      >
        <PublicMixtape token={mixtapeMatch[1]} />
      </div>
    );
  }

  if (
    window.location.pathname === `${urlBase}/db` ||
    window.location.pathname === `${urlBase}/db/`
  ) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      >
        <DatabaseViewer />
      </div>
    );
  }

  if (connection.status === 'connecting')
    return (
      <ConnectionScreen
        attempt={connection.attempt}
        message="Connecting to server"
        onRetryNow={() => retryInitRef.current?.()}
        since={connection.since}
        variant="initial"
      />
    );

  if (!initialized && setup.required !== true)
    return (
      <Loader
        active
        size="big"
      />
    );

  if (setup.required) return <Setup onComplete={handleSetupComplete} />;

  if (!isLoggedIn) {
    return (
      <LoginForm
        error={login.error}
        loading={login.pending}
        onLoginAttempt={handleLogin}
      />
    );
  }

  // ── Main app shell ────────────────────────────────────────────────────────────
  const {
    pendingReconnect,
    pendingRestart,
    relay = {},
    server,
    shares = {},
    user,
    version = {},
  } = applicationState;

  const { current, isUpdateAvailable, latest } = version;
  const { scanPending: pendingShareRescan } = shares;
  const { mode } = relay;
  const isAgent = mode === 'Agent';
  const page = getPage();
  const hasPending = pendingReconnect || pendingRestart || pendingShareRescan;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const connectionOverlay =
    connection.status === 'reconnecting' ? (
      <ConnectionScreen
        attempt={connection.attempt}
        message="Lost connection to server"
        onRetryNow={() => hubRetryRef.current?.()}
        since={connection.since}
        variant="overlay"
      />
    ) : null;

  if (window.location.pathname.endsWith('/map')) {
    return (
      <LibraryActivityProvider>
        <PlayerProvider>
          <div className="map-shell">
            <StatusStrip
              brand={
                <div className="status-brand">
                  <ResonanceMark size={18} />
                  <span className="status-brand-name">Resonance</span>
                </div>
              }
              downloads={downloads}
              isLoggedIn={isLoggedIn}
              networkInfo={networkInfo}
              onConnect={connect}
              onDisconnect={disconnect}
              onLogout={handleLogout}
              server={server}
              shares={shares}
              uploads={uploads}
              user={user}
            />
            <MapPage />
            {connectionOverlay}
          </div>
        </PlayerProvider>
      </LibraryActivityProvider>
    );
  }

  return (
    <LibraryActivityProvider>
      <PlayerProvider>
        <TagEditActivityProvider>
          <PlayTracker />
          <div className="app-shell">
            {!isAgent && (
              <StatusStrip
                brand={
                  <div className="status-brand">
                    <button
                      className="app-nav-toggle hover-fx"
                      onClick={handleToggleNav}
                      title={
                        navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
                      }
                      type="button"
                    >
                      {navCollapsed ? (
                        <PanelLeftOpen
                          size={14}
                          strokeWidth={1.75}
                        />
                      ) : (
                        <PanelLeftClose
                          size={14}
                          strokeWidth={1.75}
                        />
                      )}
                    </button>
                    <ResonanceMark size={18} />
                    <span className="status-brand-name">Resonance</span>
                    {version.isCanary && (
                      <span className="app-nav-brand-badge">canary</span>
                    )}
                  </div>
                }
                downloads={downloads}
                isLoggedIn={isLoggedIn}
                networkInfo={networkInfo}
                onConnect={connect}
                onDisconnect={disconnect}
                onLogout={handleLogout}
                server={server}
                shares={shares}
                uploads={uploads}
                user={user}
              />
            )}

            <div className="app-body">
              <nav
                className={
                  navCollapsed ? 'app-nav app-nav--collapsed' : 'app-nav'
                }
              >
                <div className="app-nav-section">
                  {isAgent ? (
                    <NavItem
                      active={page === 'system'}
                      icon={Settings}
                      label="System"
                      to={`${urlBase}/system`}
                    />
                  ) : (
                    <>
                      <NavItem
                        active={page === 'overview'}
                        icon={LayoutDashboard}
                        label="Overview"
                        to={`${urlBase}/overview`}
                      />

                      <div className="app-nav-label">Soulseek</div>
                      <NavItem
                        active={page === 'searches'}
                        icon={Search}
                        label="Search"
                        to={`${urlBase}/searches`}
                      />
                      <NavItem
                        active={page === 'downloads'}
                        badge={downloadCount}
                        icon={Download}
                        label="Downloads"
                        to={`${urlBase}/downloads`}
                      />
                      <NavItem
                        active={page === 'uploads'}
                        badge={uploadCount}
                        icon={Upload}
                        label="Uploads"
                        to={`${urlBase}/uploads`}
                      />

                      <div className="app-nav-label">Community</div>
                      <NavItem
                        active={page === 'rooms'}
                        badge={page === 'rooms' ? 0 : roomUnread}
                        icon={MessageSquare}
                        label="Rooms"
                        to={`${urlBase}/rooms`}
                      />
                      <NavItem
                        active={page === 'chat'}
                        badge={page === 'chat' ? 0 : chatUnread}
                        icon={MessageCircle}
                        label="Chat"
                        to={`${urlBase}/chat`}
                      />
                      <NavItem
                        active={page === 'users'}
                        icon={UsersIcon}
                        label="Users"
                        to={`${urlBase}/users`}
                      />
                      <NavItem
                        active={page === 'browse'}
                        icon={FolderOpen}
                        label="Browse"
                        to={`${urlBase}/browse`}
                      />

                      <div className="app-nav-label">Music</div>
                      <NavItem
                        active={page === 'library'}
                        icon={LibraryIcon}
                        label="Library"
                        to={`${urlBase}/library`}
                      />
                      <NavItem
                        active={page === 'trackanalysis'}
                        icon={KeyRound}
                        label="Track Analysis"
                        to={`${urlBase}/trackanalysis`}
                      />
                      <NavItem
                        active={page === 'tags'}
                        icon={Tag}
                        label="Tag Manager"
                        to={`${urlBase}/tags`}
                      />
                      <NavItem
                        active={page === 'duplicates'}
                        icon={Copy}
                        label="Duplicates"
                        to={`${urlBase}/duplicates`}
                      />
                      <NavItem
                        active={page === 'converter'}
                        icon={AudioLines}
                        label="Converter"
                        to={`${urlBase}/converter`}
                      />

                      <div className="app-nav-label">yt-dlp</div>
                      <NavItem
                        active={
                          page === 'ytdlp' &&
                          !window.location.pathname.endsWith('/downloads')
                        }
                        icon={Search}
                        label="Search"
                        to={`${urlBase}/ytdlp/search`}
                      />
                      <NavItem
                        active={
                          page === 'ytdlp' &&
                          window.location.pathname.endsWith('/downloads')
                        }
                        icon={Download}
                        label="Downloads"
                        to={`${urlBase}/ytdlp/downloads`}
                      />
                    </>
                  )}
                </div>

                <div className="app-nav-footer">
                  {hasPending && (
                    <NavItem
                      icon={AlertCircle}
                      label="Pending Action"
                      to={`${urlBase}/system/info`}
                    />
                  )}
                  {isUpdateAvailable && (
                    <Modal
                      centered
                      closeIcon
                      size="mini"
                      trigger={
                        <NavItem
                          icon={Megaphone}
                          label="New Version!"
                        />
                      }
                    >
                      <Modal.Header>New Version!</Modal.Header>
                      <Modal.Content>
                        <p>
                          Running <strong>{current}</strong>, version{' '}
                          <strong>{latest}</strong> is available.
                        </p>
                      </Modal.Content>
                      <Modal.Actions>
                        <Button
                          className="hover-fx"
                          fluid
                          primary
                          style={{ marginLeft: 0 }}
                        >
                          See Release Notes
                        </Button>
                      </Modal.Actions>
                    </Modal>
                  )}
                  <NavItem
                    badge={unreadCount}
                    icon={Bell}
                    label="Notifications"
                    onClick={handleToggleNotificationPanel}
                  />
                  <NavItem
                    active={page === 'system'}
                    icon={Settings}
                    label="System"
                    to={`${urlBase}/system`}
                  />
                  <NavItem
                    icon={Palette}
                    label={THEME_LABELS[theme] ?? 'Theme'}
                    onClick={cycleTheme}
                  />
                </div>
              </nav>

              <main className="app-main">
                <div className="app-content">
                  <AppContext.Provider value={appContextValue}>
                    {isAgent ? (
                      <Switch>
                        <Route
                          path={`${urlBase}/system/:tab?`}
                          render={(props) => (
                            <System
                              {...props}
                              options={applicationOptions}
                              state={applicationState}
                            />
                          )}
                        />
                        <Redirect
                          from="*"
                          to={`${urlBase}/system`}
                        />
                      </Switch>
                    ) : (
                      <Switch>
                        <Route
                          path={`${urlBase}/overview`}
                          render={() => <Overview />}
                        />
                        <Route
                          path={`${urlBase}/map`}
                          render={() => <MapPage />}
                        />
                        <Route
                          path={`${urlBase}/searches`}
                          render={(props) => (
                            <Searches
                              server={applicationState.server}
                              {...props}
                            />
                          )}
                        />
                        <Route
                          path={`${urlBase}/browse`}
                          render={(props) => <Browse {...props} />}
                        />
                        <Route
                          path={`${urlBase}/users`}
                          render={(props) => <Users {...props} />}
                        />
                        <Route
                          path={`${urlBase}/chat`}
                          render={(props) => (
                            <Chat
                              {...props}
                              state={applicationState}
                            />
                          )}
                        />
                        <Route
                          path={`${urlBase}/rooms`}
                          render={(props) => <Rooms {...props} />}
                        />
                        <Route
                          path={`${urlBase}/uploads`}
                          render={(props) => (
                            <div className="view">
                              <Transfers
                                {...props}
                                direction="upload"
                              />
                            </div>
                          )}
                        />
                        <Route
                          path={`${urlBase}/downloads`}
                          render={(props) => (
                            <div className="view">
                              <Transfers
                                {...props}
                                direction="download"
                                server={applicationState.server}
                              />
                            </div>
                          )}
                        />
                        <Route
                          path={`${urlBase}/library`}
                          render={(props) => <Library {...props} />}
                        />
                        <Route
                          path={`${urlBase}/trackanalysis`}
                          render={(props) => <TrackAnalysis {...props} />}
                        />
                        <Redirect
                          from={`${urlBase}/tagsanitization`}
                          to={`${urlBase}/tags`}
                        />
                        <Route
                          path={`${urlBase}/tags`}
                          render={() => <Tags />}
                        />
                        <Route
                          path={`${urlBase}/duplicates`}
                          render={(props) => <Duplicates {...props} />}
                        />
                        <Route
                          path={`${urlBase}/converter`}
                          render={() => <Converter />}
                        />
                        <Route
                          path={`${urlBase}/ytdlp/:view?`}
                          render={(props) => (
                            <div className="view">
                              <YtDlp view={props.match.params.view} />
                            </div>
                          )}
                        />
                        <Route
                          path={`${urlBase}/system/:tab?`}
                          render={(props) => (
                            <System
                              {...props}
                              options={applicationOptions}
                              state={applicationState}
                              theme={theme}
                            />
                          )}
                        />
                        <Redirect
                          from="*"
                          to={`${urlBase}/overview`}
                        />
                      </Switch>
                    )}
                  </AppContext.Provider>
                </div>
                <MediaPlayer />
              </main>
              <AppQueuePanel />
            </div>
          </div>

          {connectionOverlay}

          <MetadataLookupWatcher />

          {notificationPanelOpen && (
            <NotificationCentre
              notifications={notifications}
              onClear={handleClearNotifications}
              onClose={handleToggleNotificationPanel}
              onSettingsChange={handleNotificationSettingsChange}
              settings={notificationSettings}
            />
          )}

          <ToastContainer
            autoClose={5_000}
            closeOnClick
            draggable={false}
            hideProgressBar={false}
            newestOnTop
            pauseOnFocusLoss
            pauseOnHover
            position="bottom-right"
            rtl={false}
          />
        </TagEditActivityProvider>
      </PlayerProvider>
    </LibraryActivityProvider>
  );
};

export default withRouter(App);
