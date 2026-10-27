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
import './MusicWorkspace.css';
import './PageLayout.css';
import { urlBase } from '../config';
import {
  LibraryActivityProvider,
  useLibraryActivity,
} from '../context/LibraryActivityContext';
import { PlayerProvider, usePlayer } from '../context/PlayerContext';
import { TagEditActivityProvider } from '../context/TagEditActivityContext';
import * as applicationAPI from '../lib/application';
import { applyBlockedUsers } from '../lib/blockedUsers';
import * as chatAPI from '../lib/chat';
import {
  emitPrivateMessage,
  emitRoomMessage,
  onPrivateMessage,
  onRoomMessage,
} from '../lib/chatEvents';
import * as eventsAPI from '../lib/events';
import { createApplicationHubConnection } from '../lib/hubFactory';
import { createHubRetryLoop } from '../lib/hubRetryLoop';
import { createMessageBadgeSync } from '../lib/messageBadgeSync';
import * as networkAPI from '../lib/network';
import {
  formatNotification,
  loadNotificationSettings,
} from '../lib/notificationTypes';
import * as prefs from '../lib/prefs';
import * as roomsAPI from '../lib/rooms';
import { connect, disconnect } from '../lib/server';
import * as session from '../lib/session';
import { playMessageReceived } from '../lib/sound';
import { getSessionId, isAdmin, isPassthroughEnabled } from '../lib/token';
import { emitTransferComplete } from '../lib/transferEvents';
import * as transfersAPI from '../lib/transfers';
import { parseUtcDate } from '../lib/util';
import * as ytdlpAPI from '../lib/ytdlp';
import AppContext from './AppContext';
import AppsIntegrations from './AppsIntegrations/AppsIntegrations';
import Browse from './Browse/Browse';
import Chat from './Chat/Chat';
import ConnectionScreen from './ConnectionScreen';
import Converter from './Converter/Converter';
import Duplicates from './Duplicates/Duplicates';
import ExportPage from './Export/ExportPage';
import NetworkLinkPage from './Export/NetworkLinkPage';
import Library from './Library/Library';
import LoginForm from './LoginForm';
import MapPage from './Map';
import MediaPlayer from './MediaPlayer';
import MusicWorkspaceHeader from './MusicWorkspaceHeader';
import NotificationCentre from './Notifications/NotificationCentre';
import Overview from './Overview';
import StatusStrip from './Overview/StatusStrip';
import PublicMixtape from './PublicMixtape/PublicMixtape';
import QueuePanel from './Queue/QueuePanel';
import Rooms from './Rooms/Rooms';
import Searches from './Search/Searches';
import Setup from './Setup';
import ResonanceMark from './Shared/ResonanceMark';
import ZoomControl from './Shared/ZoomControl';
import StartupStatus from './StartupStatus';
import DatabaseViewer from './System/DatabaseViewer';
import Logs from './System/Logs';
import System from './System/System';
import Tags from './Tags/Tags';
import TrackAnalysis from './TrackAnalysis/TrackAnalysis';
import TransferHistory from './Transfers/TransferHistory';
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
  Globe,
  History,
  KeyRound,
  LayoutDashboard,
  Library as LibraryIcon,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Palette,
  Plug,
  Search,
  Settings,
  Tag,
  Upload,
  Wifi,
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

const THEMES = ['light', 'amoled', 'midnight', 'violet', 'ember'];
const THEME_LABELS = {
  amoled: 'AMOLED',
  light: 'Daylight',
  midnight: 'Midnight',
  violet: 'Ultraviolet',
  ember: 'Ember',
};
const ALL_THEME_CLASSES = [
  'amoled',
  'dark',
  'dim',
  'midnight',
  'violet',
  'ember',
];

const INIT_MAX_ATTEMPTS = 30;
const STATUS_STATE_CACHE_KEY = 'resonance-status-state';
const NETWORK_INFO_CACHE_KEY = 'resonance-status-network';

const readStatusCache = (key, fallback) => {
  try {
    // Keep the shell warm across new tabs and browser restarts. These values are
    // only paint-time placeholders and are refreshed as soon as authentication
    // succeeds; logout and failed session validation clear them below.
    const value = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

const writeStatusCache = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Remove values written by older builds so they cannot shadow debugging or
    // survive after the durable cache has been cleared.
    sessionStorage.removeItem(key);
  } catch {
    /* Status caching is only a rendering optimisation. */
  }
};

const clearStatusCaches = () => {
  const keys = [
    STATUS_STATE_CACHE_KEY,
    NETWORK_INFO_CACHE_KEY,
    'resonance-status-profile',
    'resonance-status-port',
  ];
  for (const key of keys) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};

const parseEventData = (raw) => {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};

// Persisted event-log record → notification. Formatting itself (icon, text,
// link) lives in lib/notificationTypes so it stays in sync with the live
// hub-pushed notifications built by addNotification below.
const notificationFromEventRecord = (record, lastReadAt) => {
  const isRead = lastReadAt
    ? parseUtcDate(record.timestamp) <= parseUtcDate(lastReadAt)
    : false;
  return {
    id: record.id,
    type: record.type,
    data: parseEventData(record.data),
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
  const page = getPage();
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
  const [startupStatus, setStartupStatus] = useState(null);
  const [setup, setSetup] = useState({
    error: undefined,
    pending: false,
    required: null,
  });
  const [login, setLogin] = useState({ error: undefined, pending: false });

  // ── Hub-derived state ───────────────────────────────────────────────────────
  const [applicationOptions, setApplicationOptions] = useState({});
  const [applicationState, setApplicationState] = useState(() =>
    readStatusCache(STATUS_STATE_CACHE_KEY, {}),
  );

  // ── UI state ────────────────────────────────────────────────────────────────
  const [chatUnread, setChatUnread] = useState(0);
  const [downloadCount, setDownloadCount] = useState(0);
  const [downloads, setDownloads] = useState([]);
  const [networkInfo, setNetworkInfo] = useState(() =>
    readStatusCache(NETWORK_INFO_CACHE_KEY, null),
  );
  const [notifications, setNotifications] = useState([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(
    loadNotificationSettings,
  );
  const [roomUnread, setRoomUnread] = useState(0);
  // Share per-room counts between the room list and navigation.
  const [roomUnreadCounts, setRoomUnreadCounts] = useState({});
  const readRoomRef = useRef(null);
  const badgeSyncRef = useRef(null);
  const handleConversationRead = useCallback(() => {
    badgeSyncRef.current?.refresh();
  }, []);
  const handleRoomRead = useCallback((roomName) => {
    if (readRoomRef.current === roomName) return;
    readRoomRef.current = roomName;
    badgeSyncRef.current?.refresh();
  }, []);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [theme, setTheme] = useState(
    () =>
      prefs.get('resonance-theme', null) ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'),
  );
  const [uploadCount, setUploadCount] = useState(0);
  const [uploads, setUploads] = useState([]);
  const [ytdlpCount, setYtdlpCount] = useState(0);

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
  const hasLiveApplicationStateRef = useRef(false);
  // "Retry now" hooks for the connection screen/overlay.
  const retryInitRef = useRef(null);
  const hubRetryRef = useRef(null);
  // Keep latest notificationSettings accessible inside hub handlers without
  // re-creating the hub every time settings change.
  const notifSettingsRef = useRef(notificationSettings);
  notifSettingsRef.current = notificationSettings;

  // ── addNotification (stable ref pattern) ────────────────────────────────────
  // Every live notification — hub pushes, blocked-user alerts — flows through
  // here and is formatted by the same lib/notificationTypes table used for
  // the persisted event log, so the bell panel and toasts never drift from it.
  const addNotification = useCallback(
    (
      type,
      data,
      {
        skipToast = false,
        sound = false,
        toastId,
        toastOptions = {},
        toastType = 'info',
      } = {},
    ) => {
      if (!notifSettingsRef.current[type]) return;
      const notification = {
        id: `${Date.now()}-${Math.random()}`,
        type,
        data,
        timestamp: new Date(),
        read: false,
      };
      setNotifications((previous) => [notification, ...previous].slice(0, 100));
      if (sound) playMessageReceived();
      if (!skipToast) {
        const { sub, text } = formatNotification(type, data);
        const message = sub ? `${text}: ${sub}` : text;
        // A stable toastId collapses a burst of the same alert into one
        // updating toast instead of stacking a new one per event — every
        // event is still recorded in full in the bell panel regardless.
        if (toastId && toast.isActive(toastId)) {
          toast.update(toastId, { render: message });
        } else {
          toast[toastType](message, { toastId, ...toastOptions });
        }
      }
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
          if (!cancelled) {
            setIsLoggedIn(valid);
            if (!valid) clearStatusCaches();
          }
        }

        if (!cancelled) {
          setInitialized(true);
          setConnection({ attempt: 0, since: null, status: 'online' });
        }
      } catch (error) {
        if (cancelled) return;
        if (initAttemptRef.current === 0) {
          console.warn('Resonance startup check failed:', error?.message);
        }

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

  // The API becomes available before heavyweight service recovery completes. Keep the app usable
  // and surface that work as a small live banner instead of holding the entire UI on a spinner.
  useEffect(() => {
    let cancelled = false;
    let timer;

    const pollStartup = async () => {
      try {
        const status = await session.getStartup();
        if (cancelled) return;
        setStartupStatus(status);
        timer = setTimeout(pollStartup, status.ready ? 15_000 : 1_000);
      } catch {
        if (!cancelled) timer = setTimeout(pollStartup, 2_000);
      }
    };

    pollStartup();
    return () => {
      cancelled = true;
      clearTimeout(timer);
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
  // Effect 3 — Bootstrap application state immediately, then keep it live via
  // the hub below. Hub negotiation can take noticeably longer than a REST
  // request; without this the status strip mounts with empty state and its
  // items pop in only after the first STATE broadcast.
  // ═══════════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLoggedIn) {
      hasLiveApplicationStateRef.current = false;
      return undefined;
    }

    let cancelled = false;
    applicationAPI
      .getState()
      .then((state) => {
        // Never let a slower bootstrap response overwrite fresher hub state.
        if (!cancelled && !hasLiveApplicationStateRef.current) {
          setApplicationState(state);
          writeStatusCache(STATUS_STATE_CACHE_KEY, state);
        }
      })
      .catch(() => {
        // The hub remains the retrying source of truth when REST is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  // ════════════════════════════════════════════════════════════════════════════════
  // Effect 3 — Hub lifecycle, tied to isLoggedIn.
  // Cleanup runs automatically on logout, re-login, or unmount.
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    // Distinguishes deliberate hub.stop() (logout, unmount, retry-now) from a
    // genuine connection loss in onclose.
    let intentionalStop = false;

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

    const retryLoop = createHubRetryLoop({
      start: () => hub.start(),
      onRetry: markReconnecting,
      onOnline: () =>
        setConnection({ attempt: 0, since: null, status: 'online' }),
    });

    let pendingState = null;
    let pendingOptions = null;
    let flushTimeout = null;
    let lastStateJson = null;

    // The backend debounces STATE broadcasts at 100ms, so a busy server pushes
    // ~10 a second — and applying one re-renders the whole app tree (~50ms of
    // main thread each, which is what the "setTimeout handler took 53ms"
    // violations were). Coalesce into at most one render per window, and drop
    // pushes whose payload is identical to the last one applied, which costs a
    // stringify of a few KB against a render three orders of magnitude dearer.
    const FLUSH_MS = 250;
    const flushPending = () => {
      flushTimeout = null;
      unstable_batchedUpdates(() => {
        if (pendingState !== null) {
          setApplicationState(pendingState);
          writeStatusCache(STATUS_STATE_CACHE_KEY, pendingState);
          pendingState = null;
        }

        if (pendingOptions !== null) {
          setApplicationOptions(pendingOptions);
          pendingOptions = null;
        }
      });
    };

    const scheduleFlush = () => {
      if (!flushTimeout) flushTimeout = setTimeout(flushPending, FLUSH_MS);
    };

    hub.on('STATE', (state) => {
      hasLiveApplicationStateRef.current = true;
      const json = JSON.stringify(state);
      if (json === lastStateJson) return;
      lastStateJson = json;
      pendingState = state;
      scheduleFlush();
    });
    hub.on('OPTIONS', (options) => {
      pendingOptions = options;
      scheduleFlush();
    });
    hub.on('BLOCKED_USERS', applyBlockedUsers);
    hub.on('BLOCKED_USER_ALERT', ({ ip, username }) => {
      addNotificationRef.current(
        'UserBlocked',
        { ip, username },
        { toastId: 'blocked-user-alert', toastType: 'warn' },
      );
    });

    hub.onreconnecting(() => {
      retryLoop.reconnecting();
    });

    hub.onclose(() => {
      if (intentionalStop) return;
      // Automatic reconnect gave up (or the connection was force-closed);
      // fall back to the manual start loop so we never dead-end.
      retryLoop.closed();
    });

    hub.onreconnected(() => {
      emitPrivateMessage({ reconcile: true });
      retryLoop.connected();
    });

    hub.on('CONVERSATION_CHANGED', (detail) => emitPrivateMessage(detail));
    hub.on('ROOM_MESSAGE', (detail) => emitRoomMessage(detail));

    hub.on('PRIVATE_MESSAGE', ({ message, username }) => {
      emitPrivateMessage({ message, username });
      addNotificationRef.current(
        'PrivateMessageReceived',
        { message: { message, username } },
        { sound: true },
      );
    });

    hub.on('BROWSED', (username) => {
      addNotificationRef.current('Browsed', { username });
    });

    // A completed transfer is the moment a peer appears in / updates the
    // telemetry user list; re-broadcast so live views can refresh instantly.
    hub.on('UPLOAD_FILE_COMPLETE', ({ filename, username }) => {
      emitTransferComplete({ direction: 'upload', username });
      addNotificationRef.current('UploadFileComplete', {
        remoteFilename: filename,
        transfer: { username },
      });
    });
    hub.on('DOWNLOAD_DIRECTORY_COMPLETE', ({ directoryName, username }) => {
      emitTransferComplete({ direction: 'download', username });
      addNotificationRef.current('DownloadDirectoryComplete', {
        remoteDirectoryName: directoryName,
        username,
      });
    });

    hub.on('ROOM_MENTION', ({ message, roomName, username }) => {
      addNotificationRef.current(
        'RoomMention',
        { message, roomName, username },
        { sound: true },
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
      retryLoop.pause();
      intentionalStop = true;
      try {
        await hub.stop();
      } catch {
        /* ignore */
      }

      intentionalStop = false;
      retryLoop.retryNow();
    };

    retryLoop.start();

    // Cleanup: hub stops when isLoggedIn becomes false (logout) or component unmounts.
    return () => {
      intentionalStop = true;
      clearTimeout(flushTimeout);
      retryLoop.dispose();
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
            .map((e) => notificationFromEventRecord(e, lastReadAt))
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
        if (!cancelled) {
          setNetworkInfo(info);
          writeStatusCache(NETWORK_INFO_CACHE_KEY, info);
        }
      } catch {
        /* silently ignore */
      }
    };

    load();
    loadNetworkInfo();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  // ══════════════════════════════════════════════════════════════════════════════
  // Effect 5 — Transfer count polling (badge counts in nav).
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [downloadGroups, uploadGroups, ytdlpJobs] = await Promise.all([
          transfersAPI.getAll({ direction: 'download' }).catch(() => null),
          transfersAPI.getAll({ direction: 'upload' }).catch(() => null),
          ytdlpAPI
            .listJobs()
            .then((r) => r.data)
            .catch(() => null),
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

        // Tracks not yet resolved across in-flight yt-dlp jobs (mirrors the
        // per-job "remaining" maths in YtDlp/JobList.jsx)
        const countYtdlpRemaining = (jobsList) => {
          if (!Array.isArray(jobsList)) return 0;
          return jobsList
            .filter((j) =>
              ['active', 'enumerating', 'paused'].includes(
                (j.state || '').toLowerCase(),
              ),
            )
            .reduce(
              (sum, j) =>
                sum +
                Math.max(
                  0,
                  j.totalTracks -
                    j.completedTracks -
                    j.failedTracks -
                    j.skippedTracks,
                ),
              0,
            );
        };

        unstable_batchedUpdates(() => {
          setDownloadCount(countActive(downloadGroups));
          setDownloads(flattenTransfers(downloadGroups));
          setUploadCount(countActive(uploadGroups));
          setUploads(flattenTransfers(uploadGroups));
          setYtdlpCount(countYtdlpRemaining(ytdlpJobs));
        });
      } catch {
        /* silently ignore */
      } finally {
        // eslint-disable-next-line require-atomic-updates -- Only the poll that set this flag can release it.
        inFlight = false;
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

    const sync = createMessageBadgeSync({
      getConversations: chatAPI.getAll,
      getRoomCounts: roomsAPI.getMessageCounts,
      getActiveRoom: () => readRoomRef.current,
      getPage,
      isVisible: () => !document.hidden,
      baselines: roomBaselines.current,
      update: ({ chats, roomUnreadCounts: counts, rooms }) =>
        unstable_batchedUpdates(() => {
          if (chats !== undefined) setChatUnread(chats);
          if (rooms !== undefined) setRoomUnread(rooms);
          if (counts !== undefined) setRoomUnreadCounts(counts);
        }),
    });
    badgeSyncRef.current = sync;
    const refresh = () => sync.refresh();
    const unsubscribeChat = onPrivateMessage(refresh);
    const unsubscribeRoom = onRoomMessage(refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('popstate', refresh);
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      clearInterval(id);
      unsubscribeChat();
      unsubscribeRoom();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('popstate', refresh);
      sync.stop();
      badgeSyncRef.current = null;
    };
  }, [isLoggedIn, page]);

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
    // Signing out is local state; if the server call fails (it's down, the session
    // is already gone) that's no reason to keep someone logged in.
    try {
      await session.logout();
    } catch (error) {
      console.debug('logout request failed, signing out locally anyway', error);
    }

    setIsLoggedIn(false);
    setApplicationState({});
    setNetworkInfo(null);
    clearStatusCaches();
    setApplicationOptions({});
    setLogin({ error: undefined, pending: false });
    setConnection({ attempt: 0, since: null, status: 'online' });
  }, []);

  const handleSetupComplete = useCallback(() => {
    setSetup((s) => ({ ...s, required: false }));
    setIsLoggedIn(true);
  }, []);

  const handleToggleNotificationPanel = useCallback(() => {
    setNotificationPanelOpen((previous) => !previous);
  }, []);

  const handleMarkAllNotificationsRead = useCallback(() => {
    localStorage.setItem(
      'resonance-notifications-last-read',
      new Date().toISOString(),
    );
    setNotifications((previous) => previous.map((n) => ({ ...n, read: true })));
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

  const chooseTheme = useCallback((selectedTheme) => {
    prefs.set('resonance-theme', selectedTheme);
    setTheme(selectedTheme);
  }, []);

  // ── Apply theme classes ───────────────────────────────────────────────────────
  for (const cls of ALL_THEME_CLASSES)
    document.documentElement.classList.remove(cls);
  if (theme !== 'light') document.documentElement.classList.add(theme);
  if (['midnight', 'violet', 'ember'].includes(theme))
    document.documentElement.classList.add('amoled');

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

  if (
    window.location.pathname === `${urlBase}/logs-popup` ||
    window.location.pathname === `${urlBase}/logs-popup/`
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
        <Logs />
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
      <>
        <StartupStatus status={startupStatus} />
        <Loader
          active
          size="big"
        />
      </>
    );

  if (setup.required)
    return (
      <>
        <StartupStatus status={startupStatus} />
        <Setup onComplete={handleSetupComplete} />
      </>
    );

  if (!isLoggedIn) {
    return (
      <>
        <StartupStatus status={startupStatus} />
        <LoginForm
          error={login.error}
          loading={login.pending}
          onLoginAttempt={handleLogin}
        />
      </>
    );
  }

  // ── Main app shell ────────────────────────────────────────────────────────────
  const {
    disk,
    pendingReconnect,
    pendingRestart,
    relay = {},
    server,
    shares = {},
    system,
    user,
    version = {},
  } = applicationState;

  const { current, isUpdateAvailable, latest } = version;
  const { scanPending: pendingShareRescan } = shares;
  const { mode } = relay;
  const isAgent = mode === 'Agent';
  const musicWorkspace = [
    'library',
    'trackanalysis',
    'export',
    'networklink',
    'tags',
    'duplicates',
    'converter',
  ].includes(page);
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

  if (window.location.pathname.endsWith('/map') && isAdmin()) {
    return (
      <LibraryActivityProvider>
        <PlayerProvider>
          <div className="map-shell">
            <StartupStatus status={startupStatus} />
            <StatusStrip
              brand={
                <div className="status-brand">
                  <ResonanceMark size={22} />
                  <span className="status-brand-name">Resonance</span>
                </div>
              }
              disk={disk}
              downloads={downloads}
              isLoggedIn={isLoggedIn}
              networkInfo={networkInfo}
              onConnect={connect}
              onDisconnect={disconnect}
              onLogout={handleLogout}
              server={server}
              shares={shares}
              startupStatus={startupStatus}
              system={system}
              uploads={uploads}
              upnp={applicationState?.upnp}
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
          <div className="app-shell dj-workspace">
            <StartupStatus status={startupStatus} />
            {!isAgent && (
              <StatusStrip
                brand={
                  <div className="status-brand">
                    <ResonanceMark size={22} />
                    <span className="status-brand-name">Resonance</span>
                    {version.isCanary && (
                      <span className="app-nav-brand-badge">canary</span>
                    )}
                  </div>
                }
                disk={disk}
                downloads={downloads}
                isLoggedIn={isLoggedIn}
                networkInfo={networkInfo}
                onConnect={connect}
                onDisconnect={disconnect}
                onLogout={handleLogout}
                server={server}
                shares={shares}
                startupStatus={startupStatus}
                system={system}
                uploads={uploads}
                upnp={applicationState?.upnp}
                user={user}
                viewControls={<ZoomControl />}
              />
            )}

            <div className="app-body">
              <div className="app-nav-rail">
                <nav
                  aria-label="Main navigation"
                  className="app-nav"
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
                        <div className="app-nav-label">
                          <span>Music</span>
                        </div>
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
                          active={page === 'export'}
                          icon={Upload}
                          label="Export"
                          to={`${urlBase}/export`}
                        />
                        <NavItem
                          active={page === 'networklink'}
                          icon={Wifi}
                          label="Network Link"
                          to={`${urlBase}/networklink`}
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

                        <div className="app-nav-label">
                          <span>Soulseek</span>
                        </div>
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

                        <NavItem
                          active={page === 'history'}
                          icon={History}
                          label="History"
                          to={`${urlBase}/history`}
                        />
                        {isAdmin() && (
                          <NavItem
                            active={page === 'live-map'}
                            icon={Globe}
                            label="Live Map"
                            to={`${urlBase}/live-map`}
                          />
                        )}

                        <div className="app-nav-label">
                          <span>Community</span>
                        </div>
                        <NavItem
                          active={page === 'rooms'}
                          badge={roomUnread}
                          icon={MessageSquare}
                          label="Rooms"
                          to={`${urlBase}/rooms`}
                        />
                        <NavItem
                          active={page === 'chat'}
                          badge={chatUnread}
                          icon={MessageCircle}
                          label="Chat"
                          to={`${urlBase}/chat`}
                        />
                        <NavItem
                          active={page === 'browse'}
                          icon={FolderOpen}
                          label="Browse"
                          to={`${urlBase}/browse`}
                        />

                        <div className="app-nav-label">
                          <span>yt-dlp</span>
                        </div>
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
                          badge={ytdlpCount}
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
                    {!isAgent && (
                      <NavItem
                        active={page === 'apps'}
                        icon={Plug}
                        label="Apps & integrations"
                        to={`${urlBase}/apps`}
                      />
                    )}
                    <NavItem
                      active={page === 'system'}
                      icon={Settings}
                      label="System"
                      to={`${urlBase}/system`}
                    />
                    <div
                      className={
                        isAgent ? 'app-appearance-controls' : undefined
                      }
                    >
                      <NavItem
                        icon={Palette}
                        label={THEME_LABELS[theme] ?? 'Theme'}
                        onClick={() => setThemePickerOpen(true)}
                      />
                      <Modal
                        closeIcon
                        onClose={() => setThemePickerOpen(false)}
                        open={themePickerOpen}
                        size="small"
                      >
                        <Modal.Header>Choose your atmosphere</Modal.Header>
                        <Modal.Content>
                          <p>
                            Colour for your collection, from daylight browsing
                            to late-night sets.
                          </p>
                          <div className="theme-palette-grid">
                            {THEMES.map((option) => (
                              <button
                                aria-pressed={theme === option}
                                className={`theme-palette theme-palette--${option}`}
                                key={option}
                                onClick={() => chooseTheme(option)}
                                type="button"
                              >
                                <span
                                  aria-hidden="true"
                                  className="theme-palette-preview"
                                >
                                  <i />
                                  <i />
                                  <i />
                                </span>
                                <strong>{THEME_LABELS[option]}</strong>
                                <span>
                                  {theme === option
                                    ? 'Selected'
                                    : 'Preview theme'}
                                </span>
                              </button>
                            ))}
                          </div>
                        </Modal.Content>
                        <Modal.Actions>
                          <Button onClick={() => setThemePickerOpen(false)}>
                            Done
                          </Button>
                        </Modal.Actions>
                      </Modal>
                      {isAgent && <ZoomControl />}
                    </div>
                  </div>
                </nav>
              </div>

              <main className="app-main">
                {musicWorkspace && page !== 'library' && (
                  <MusicWorkspaceHeader page={page} />
                )}
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
                          path={`${urlBase}/live-map`}
                          render={() =>
                            isAdmin() ? (
                              <MapPage popoutUrl={`${urlBase}/map`} />
                            ) : (
                              <Redirect to={`${urlBase}/searches`} />
                            )
                          }
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
                              onConversationRead={handleConversationRead}
                              state={applicationState}
                            />
                          )}
                        />
                        <Route
                          path={`${urlBase}/rooms`}
                          render={(props) => (
                            <Rooms
                              {...props}
                              onRoomRead={handleRoomRead}
                              unreadCounts={roomUnreadCounts}
                            />
                          )}
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
                          path={`${urlBase}/history`}
                          render={() => (
                            <div className="view">
                              <TransferHistory />
                            </div>
                          )}
                        />
                        <Route
                          path={`${urlBase}/library`}
                          render={(props) => <Library {...props} />}
                        />
                        <Route
                          path={`${urlBase}/apps`}
                          render={() => <AppsIntegrations />}
                        />
                        <Route
                          path={`${urlBase}/networklink`}
                          render={() => <NetworkLinkPage />}
                        />
                        <Route
                          path={`${urlBase}/export`}
                          render={() => <ExportPage />}
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

          {notificationPanelOpen && (
            <NotificationCentre
              notifications={notifications}
              onClear={handleClearNotifications}
              onClose={handleToggleNotificationPanel}
              onMarkAllRead={handleMarkAllNotificationsRead}
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
