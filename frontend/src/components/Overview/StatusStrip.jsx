import * as serverAPI from '../../lib/server';
import * as session from '../../lib/session';
import * as sharesAPI from '../../lib/shares';
import { formatBytes } from '../../lib/util';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CloudOff,
  FolderOpen,
  Globe,
  LogOut,
  Moon,
  Plug,
  PlugZap,
  RefreshCw,
  Shield,
  ShieldOff,
  Star,
  Wifi,
  WifiOff,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { toast } from 'react-toastify';

const StatusStrip = ({
  brand,
  downloads,
  isLoggedIn,
  networkInfo,
  onConnect,
  onDisconnect,
  onLogout,
  server,
  shares,
  uploads,
  user,
}) => {
  const [rescanning, setRescanning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [presence, setPresence] = useState('Online');
  const [description, setDescription] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [portStatus, setPortStatus] = useState(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!isLoggedIn) return;
    session
      .getStatus()
      .then(({ description: d, presence: p }) => {
        setPresence(p ?? 'Online');
        setDescription(d ?? '');
        setDescDraft(d ?? '');
      })
      .catch(() => {});
  }, [isLoggedIn]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
        setMenuPos(null);
      }
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const runPortCheck = async () => {
    setPortStatus('checking');
    try {
      const result = await serverAPI.checkPort();
      setPortStatus(result);
    } catch {
      setPortStatus('error');
    }
  };

  // Check the listening port once the client is logged in to the network.
  useEffect(() => {
    if (!server?.isLoggedIn) {
      setPortStatus(null);
      return;
    }

    runPortCheck();
  }, [server?.isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSetPresence = async (p) => {
    try {
      const result = await session.setStatus({ presence: p });
      setPresence(result.presence);
    } catch {
      toast.error('Failed to set status');
    }
  };

  const handleSaveDescription = async () => {
    setSaving(true);
    try {
      const result = await session.setStatus({ description: descDraft });
      setDescription(result.description);
      toast.success('Status comment saved');
    } catch {
      toast.error('Failed to save status comment');
    } finally {
      setSaving(false);
    }
  };

  const isConnected = server?.isLoggedIn;
  const username = user?.username;
  const isPrivileged = user?.privileges?.isPrivileged;
  // The Soulseek server reports privileges as seconds remaining, not days.
  const privilegeSeconds = user?.privileges?.privilegesRemaining;
  const fileCount = shares?.files ?? 0;
  const directoryCount = shares?.directories ?? 0;
  const scanning = shares?.scanning;
  const scanPct = Math.round((shares?.scanProgress ?? 0) * 100);
  const scanPending = shares?.scanPending;

  const activeDownloads = Array.isArray(downloads)
    ? downloads.filter((t) => t.state === 'InProgress')
    : [];
  const activeUploads = Array.isArray(uploads)
    ? uploads.filter((t) => t.state === 'InProgress')
    : [];
  const queuedCount =
    (Array.isArray(downloads)
      ? downloads.filter(
          (t) => t.state?.startsWith('Queued') || t.state === 'Requested',
        ).length
      : 0) +
    (Array.isArray(uploads)
      ? uploads.filter(
          (t) => t.state?.startsWith('Queued') || t.state === 'Requested',
        ).length
      : 0);
  const dlSpeed = activeDownloads.reduce(
    (s, t) => s + (t.averageSpeed ?? 0),
    0,
  );
  const ulSpeed = activeUploads.reduce((s, t) => s + (t.averageSpeed ?? 0), 0);

  const handleRescan = async () => {
    if (scanning || rescanning) return;
    try {
      setRescanning(true);
      await sharesAPI.rescan();
    } catch {
      toast.error('Failed to start rescan');
    } finally {
      setRescanning(false);
    }
  };

  const presenceColor =
    presence === 'Online' ? '#48bb78' : presence === 'Away' ? '#ecc94b' : null;

  return (
    <div className="status-strip">
      {brand && (
        <>
          {brand}
          <div className="status-strip-sep" />
        </>
      )}

      {/* Connection toggle */}
      <button
        className={`status-strip-item status-strip-conn-btn${isConnected ? ' connected' : ' disconnected'}`}
        onClick={() => (isConnected ? onDisconnect?.() : onConnect?.())}
        title={
          isConnected
            ? 'Click to disconnect from Soulseek'
            : 'Click to connect to Soulseek'
        }
        type="button"
      >
        {isConnected ? (
          <Wifi
            className="status-icon connected"
            size={13}
            strokeWidth={1.75}
          />
        ) : (
          <WifiOff
            className="status-icon disconnected"
            size={13}
            strokeWidth={1.75}
          />
        )}
      </button>

      {/* Username + status context menu */}
      {isConnected && username && (
        <div className="status-user-wrap">
          <button
            className="status-strip-item status-strip-username-btn"
            onClick={() => {
              if (menuOpen) {
                setMenuOpen(false);
                setMenuPos(null);
                return;
              }

              const rect = triggerRef.current?.getBoundingClientRect();
              if (rect) setMenuPos({ left: rect.left, top: rect.bottom + 4 });
              setMenuOpen(true);
            }}
            ref={triggerRef}
            type="button"
          >
            {presence === 'Away' ? (
              <Moon
                className="status-icon"
                size={12}
                strokeWidth={1.75}
                style={{ color: '#ecc94b' }}
              />
            ) : presenceColor ? (
              <span
                className="status-presence-dot"
                style={{ background: presenceColor }}
              />
            ) : (
              <CloudOff
                className="status-icon"
                size={12}
                strokeWidth={1.75}
                style={{ color: '#6b7280' }}
              />
            )}
            <span className="status-strip-text">{username}</span>
            {isPrivileged && (
              <span className="status-chip privilege">
                <Star size={9} />
                {privilegeSeconds == null
                  ? 'Privileged'
                  : privilegeSeconds >= 86_400
                    ? `${Math.floor(privilegeSeconds / 86_400)}d`
                    : privilegeSeconds >= 3_600
                      ? `${Math.floor(privilegeSeconds / 3_600)}h`
                      : privilegeSeconds >= 60
                        ? `${Math.floor(privilegeSeconds / 60)}m`
                        : `${privilegeSeconds}s`}
              </span>
            )}
          </button>

          {menuOpen &&
            menuPos &&
            ReactDOM.createPortal(
              <div
                className="status-menu"
                ref={menuRef}
                style={{
                  left: menuPos.left,
                  position: 'fixed',
                  top: menuPos.top,
                }}
              >
                <div className="status-menu-section">Presence</div>
                <button
                  className={`status-menu-item${presence === 'Online' ? ' active' : ''}`}
                  onClick={() => handleSetPresence('Online')}
                  type="button"
                >
                  <span
                    className="status-menu-dot"
                    style={{ background: '#48bb78' }}
                  />
                  Online
                  {presence === 'Online' && (
                    <Check
                      className="status-menu-check"
                      size={11}
                    />
                  )}
                </button>
                <button
                  className={`status-menu-item${presence === 'Away' ? ' active' : ''}`}
                  onClick={() => handleSetPresence('Away')}
                  type="button"
                >
                  <Moon
                    size={12}
                    strokeWidth={1.75}
                    style={{ color: '#ecc94b', flexShrink: 0 }}
                  />
                  Away
                  {presence === 'Away' && (
                    <Check
                      className="status-menu-check"
                      size={11}
                    />
                  )}
                </button>

                <div className="status-menu-divider" />
                <div className="status-menu-section">Status comment</div>
                <div className="status-menu-desc-row">
                  <input
                    className="status-menu-desc-input"
                    maxLength={120}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && handleSaveDescription()
                    }
                    placeholder="What are you up to?"
                    type="text"
                    value={descDraft}
                  />
                  <button
                    className="status-menu-desc-save"
                    disabled={saving || descDraft === description}
                    onClick={handleSaveDescription}
                    type="button"
                  >
                    <Check size={12} />
                  </button>
                </div>
              </div>,
              document.body,
            )}
        </div>
      )}

      {/* Listening port reachability */}
      {isConnected && portStatus && (
        <>
          <div className="status-strip-sep" />
          <button
            className="status-strip-item status-strip-btn--label"
            disabled={portStatus === 'checking'}
            onClick={runPortCheck}
            title={
              portStatus === 'checking'
                ? 'Checking listening port…'
                : portStatus === 'error'
                  ? 'Port check failed — click to retry'
                  : `Listening port ${portStatus.port} is ${portStatus.isOpen ? 'open (reachable)' : 'closed (not reachable from the internet)'} — click to re-check`
            }
            type="button"
          >
            {portStatus.isOpen ? (
              <PlugZap
                className="status-icon connected"
                size={13}
                strokeWidth={1.75}
              />
            ) : (
              <Plug
                className="status-icon disconnected"
                size={13}
                strokeWidth={1.75}
              />
            )}
            <span className="status-strip-text">
              {portStatus === 'checking'
                ? 'Port…'
                : portStatus === 'error'
                  ? 'Port ?'
                  : portStatus.isOpen
                    ? 'Port open'
                    : 'Port closed'}
            </span>
          </button>
        </>
      )}

      <div className="status-strip-sep" />

      <div className="status-strip-item">
        <FolderOpen
          className="status-icon"
          size={13}
          strokeWidth={1.75}
        />
        <span className="status-strip-text">
          {fileCount.toLocaleString()} files
          {directoryCount > 0 && `, ${directoryCount.toLocaleString()} dirs`}
        </span>
        {scanning && (
          <span className="status-chip scanning">
            Scanning… {scanPct > 0 ? `${scanPct}%` : ''}
          </span>
        )}
        {scanPending && !scanning && (
          <span className="status-chip pending">Pending</span>
        )}
        <button
          className="status-strip-btn"
          disabled={scanning || rescanning}
          onClick={handleRescan}
          title="Rescan shares"
          type="button"
        >
          <RefreshCw
            className={scanning || rescanning ? 'spinning' : ''}
            size={12}
            strokeWidth={1.75}
          />
        </button>
      </div>

      <div className="status-strip-sep" />

      <div className="status-strip-item">
        <span className="status-strip-text">
          {queuedCount > 0 ? `${queuedCount} queued` : 'Queue empty'}
        </span>
      </div>

      <div className="status-strip-sep" />

      <div className="status-strip-item">
        <ArrowDown
          className="status-icon"
          size={12}
          strokeWidth={1.75}
        />
        <span className="status-strip-text status-strip-speed">
          {formatBytes(dlSpeed)}/s
        </span>
        <ArrowUp
          className="status-icon"
          size={12}
          strokeWidth={1.75}
        />
        <span className="status-strip-text status-strip-speed">
          {formatBytes(ulSpeed)}/s
        </span>
      </div>

      {networkInfo && (
        <>
          <div className="status-strip-sep" />
          <div className="status-strip-item">
            <Globe
              className="status-icon"
              size={13}
              strokeWidth={1.75}
            />
            <span className="status-strip-text">{networkInfo.ip}</span>
            {networkInfo.country && (
              <span className="status-strip-text status-strip-muted">
                {networkInfo.countryCode}
              </span>
            )}
            {networkInfo.isp && (
              <span className="status-strip-text status-strip-muted">
                {networkInfo.isp}
              </span>
            )}
            {networkInfo.isVpn ? (
              <span className="status-chip vpn-on">
                <Shield size={9} />
                VPN
              </span>
            ) : (
              <span className="status-chip vpn-off">
                <ShieldOff size={9} />
                No VPN
              </span>
            )}
          </div>
        </>
      )}

      <div className="status-strip-spacer" />

      {isLoggedIn && onLogout && (
        <>
          <div className="status-strip-sep" />
          <div className="status-strip-item">
            <button
              className="status-strip-btn status-strip-btn--label"
              onClick={onLogout}
              title="Log out"
              type="button"
            >
              <LogOut
                size={12}
                strokeWidth={1.75}
              />
              <span>Log out</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default StatusStrip;
