import './Users.css';
import '../Search/Search.css';
import * as networkAPI from '../../lib/network';
import * as prefs from '../../lib/prefs';
import * as users from '../../lib/users';
import {
  AlertCircle,
  CheckCircle,
  Loader,
  MessageSquare,
  Plus,
  User,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Modal } from 'semantic-ui-react';

const RECENT_USERS_KEY = 'resonance-recent-users';
const SIDEBAR_WIDTH_KEY = 'resonance-users-sidebar-width';
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const MAX_RECENT = 25;

const loadRecentUsers = () => {
  const value = prefs.get(RECENT_USERS_KEY, []);
  return Array.isArray(value) ? value : [];
};

const saveRecentUsers = (list) => {
  prefs.set(RECENT_USERS_KEY, list);
};

const addToRecent = (username, list) => {
  const filtered = list.filter(
    (u) => u.toLowerCase() !== username.toLowerCase(),
  );
  return [username, ...filtered].slice(0, MAX_RECENT);
};

// ── Lookup modal ──────────────────────────────────────────────────────────────

const LookupModal = ({ onClose, onLookup, open }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handle = () => {
    const u = value.trim();
    if (!u) return;
    onLookup(u);
    onClose();
  };

  return (
    <Modal
      centered
      onClose={onClose}
      open={open}
      size="small"
    >
      <div className="smm-modal">
        <div className="smm-header">
          <span className="smm-title">Look Up User</span>
          <button
            className="smm-close hover-fx"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
        <div className="smm-body">
          <div className="smm-field">
            <label className="smm-label">Username</label>
            <input
              className="smm-input"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handle()}
              placeholder="Enter a username"
              ref={inputRef}
              value={value}
            />
          </div>
        </div>
        <div className="smm-footer">
          <button
            className="smm-btn smm-btn--cancel hover-fx"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="smm-btn smm-btn--send hover-fx"
            disabled={!value.trim()}
            onClick={handle}
            type="button"
          >
            Look Up
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ── Presence dot ─────────────────────────────────────────────────────────────

const PresenceDot = ({ presence, size = 8 }) => {
  const color =
    presence === 'Online'
      ? '#48bb78'
      : presence === 'Away'
        ? '#ecc94b'
        : 'var(--text-dim)';
  return (
    <span
      className="usr-presence-dot"
      style={{ background: color, width: size, height: size }}
      title={presence || 'Offline'}
    />
  );
};

// ── User detail panel ─────────────────────────────────────────────────────────

const UserDetail = ({ onBrowse, onChat, onClose, userData, username }) => {
  const {
    address,
    description,
    hasFreeUploadSlot,
    hasPicture,
    picture,
    port,
    presence,
    queueLength,
    uploadSlots,
  } = userData;

  const [ipInfo, setIpInfo] = useState(null);

  useEffect(() => {
    if (!address) return;
    setIpInfo(null);
    networkAPI
      .lookupIp(address)
      .then(setIpInfo)
      .catch(() => {});
  }, [address]);

  return (
    <div className="sr-detail">
      <div className="sr-detail-header">
        <span className="sr-detail-header-icon">
          <PresenceDot
            presence={presence}
            size={10}
          />
        </span>
        <span className="sr-detail-header-title">{username}</span>
        <div className="sr-detail-header-actions">
          <button
            className="sr-btn hover-fx"
            onClick={onChat}
            type="button"
          >
            <MessageSquare size={13} /> Chat
          </button>
          {onBrowse && (
            <button
              className="sr-btn hover-fx"
              onClick={onBrowse}
              type="button"
            >
              Browse files
            </button>
          )}
          <button
            className="sr-btn hover-fx"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="usr-detail-body">
        {/* Avatar */}
        <div className="usr-avatar-wrap">
          {hasPicture && picture ? (
            <img
              alt={username}
              className="usr-avatar"
              src={`data:image;base64,${picture}`}
            />
          ) : (
            <div className="usr-avatar-placeholder">
              <User
                size={40}
                strokeWidth={1}
              />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="usr-stats">
          <div className="usr-stat">
            <span className="usr-stat-label">Status</span>
            <span className="usr-stat-value usr-stat-presence">
              <PresenceDot presence={presence} />
              {presence || 'Offline'}
            </span>
          </div>
          <div className="usr-stat">
            <span className="usr-stat-label">Free upload slot</span>
            <span className="usr-stat-value">
              {hasFreeUploadSlot ? (
                <span className="usr-stat--yes">
                  <CheckCircle size={13} /> Yes
                </span>
              ) : (
                <span className="usr-stat--no">
                  <XCircle size={13} /> No
                </span>
              )}
            </span>
          </div>
          <div className="usr-stat">
            <span className="usr-stat-label">Upload slots</span>
            <span className="usr-stat-value">{uploadSlots ?? '—'}</span>
          </div>
          <div className="usr-stat">
            <span className="usr-stat-label">Queue length</span>
            <span className="usr-stat-value">{queueLength ?? '—'}</span>
          </div>
          {address && (
            <div className="usr-stat">
              <span className="usr-stat-label">Address</span>
              <span className="usr-stat-value usr-stat-mono">
                {address}
                {port ? `:${port}` : ''}
              </span>
            </div>
          )}
          {ipInfo && (
            <>
              {ipInfo.isp && (
                <div className="usr-stat">
                  <span className="usr-stat-label">ISP</span>
                  <span className="usr-stat-value">{ipInfo.isp}</span>
                </div>
              )}
              {ipInfo.country && (
                <div className="usr-stat">
                  <span className="usr-stat-label">Country</span>
                  <span className="usr-stat-value">{ipInfo.country}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Description */}
        {description && (
          <div className="usr-description">
            <div className="usr-description-label">Info</div>
            <div className="usr-description-body">{description}</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const Users = () => {
  const location = useLocation();
  const history = useHistory();
  const rootRef = useRef(null);
  const dividerMoveRef = useRef(null);

  const [selectedUsername, setSelectedUsername] = useState(null);
  const [userData, setUserData] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [recentUsers, setRecentUsers] = useState(loadRecentUsers);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(prefs.get(SIDEBAR_WIDTH_KEY, 220));
    return Number.isFinite(saved) ? saved : 220;
  });
  const [lookupModalOpen, setLookupModalOpen] = useState(false);

  // ── Fetch user info ────────────────────────────────────────────────────────
  const fetchUser = useCallback(async (username) => {
    if (!username) return;
    setFetching(true);
    setFetchError(null);
    setUserData(null);
    setSelectedUsername(username);
    setRecentUsers((previous) => {
      const next = addToRecent(username, previous);
      saveRecentUsers(next);
      return next;
    });

    try {
      const [info, status, endpoint] = await Promise.all([
        users.getInfo({ username }),
        users.getStatus({ username }),
        users.getEndpoint({ username }),
      ]);
      setUserData({ ...info.data, ...status.data, ...endpoint.data, username });
    } catch (error) {
      setFetchError(error);
    } finally {
      setFetching(false);
    }
  }, []);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clear = useCallback(() => {
    setSelectedUsername(null);
    setUserData(null);
    setFetchError(null);
  }, []);

  // ── Mount ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored =
      location.state?.user || prefs.get('resonance-active-user', null);
    if (stored) {
      fetchUser(stored);
    }

    const onKey = (e) => {
      if (e.key === 'Escape') clear();
    };

    document.addEventListener('keyup', onKey, false);
    return () => document.removeEventListener('keyup', onKey, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist last viewed ────────────────────────────────────────────────────
  useEffect(() => {
    prefs.set('resonance-active-user', selectedUsername || null);
  }, [selectedUsername]);

  // ── Resizable divider ──────────────────────────────────────────────────────
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

  const removeRecent = (username, e) => {
    e.stopPropagation();
    setRecentUsers((previous) => {
      const next = previous.filter((u) => u !== username);
      saveRecentUsers(next);
      return next;
    });
    if (selectedUsername === username) clear();
  };

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
            <span className="sr-sidebar-title">
              <User
                size={14}
                strokeWidth={2}
              />
              Users
            </span>
            {fetching && (
              <span
                className="sr-searching-spinner"
                style={{ flexShrink: 0 }}
              />
            )}
            <button
              className="sr-create-btn hover-fx"
              onClick={() => setLookupModalOpen(true)}
              title="Look up user"
              type="button"
            >
              <Plus size={15} />
            </button>
            {selectedUsername && (
              <button
                className="sr-create-btn br-clear-btn hover-fx"
                onClick={clear}
                title="Clear"
                type="button"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {fetchError && (
            <div className="sr-sidebar-status sr-sidebar-status--error">
              User not found
            </div>
          )}

          <div className="sr-search-list">
            {recentUsers.length === 0 && (
              <div className="sr-search-list-empty">No recent users</div>
            )}
            {recentUsers.map((username) => (
              <div
                className={`sr-search-item${selectedUsername === username ? ' sr-search-item--active' : ''}`}
                key={username}
                onClick={() => fetchUser(username)}
                onKeyDown={(e) => e.key === 'Enter' && fetchUser(username)}
                role="button"
                tabIndex={0}
              >
                <span className="sr-search-item-icon">
                  <User size={13} />
                </span>
                <span className="sr-search-item-text">{username}</span>
                <button
                  className="sr-search-item-action"
                  onClick={(e) => removeRecent(username, e)}
                  title="Remove"
                  type="button"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
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
          {fetching ? (
            <div className="sr-empty">
              <Loader
                className="sr-spin"
                size={28}
                strokeWidth={1.5}
              />
              <p>Looking up {selectedUsername}…</p>
            </div>
          ) : fetchError ? (
            <div className="sr-empty">
              <AlertCircle
                size={32}
                strokeWidth={1.25}
              />
              <p>
                Could not find user <strong>{selectedUsername}</strong>
              </p>
            </div>
          ) : userData ? (
            <UserDetail
              onChat={() => history.push('/chat', { user: selectedUsername })}
              onClose={clear}
              userData={userData}
              username={selectedUsername}
            />
          ) : (
            <div className="sr-empty">
              <UserX
                size={32}
                strokeWidth={1.25}
              />
              <p>Look up a user to view their info</p>
              <button
                className="chat-start-btn hover-fx"
                onClick={() => setLookupModalOpen(true)}
                type="button"
              >
                Look Up User
              </button>
            </div>
          )}
        </div>
      </div>
      <LookupModal
        onClose={() => setLookupModalOpen(false)}
        onLookup={fetchUser}
        open={lookupModalOpen}
      />
    </>
  );
};

export default Users;
