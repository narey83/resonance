// <copyright file="StatusStrip.jsx" company="John Narey">
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

import { urlBase } from '../../config';
import { toast } from '../../lib/activityNotices';
import { connectionStatus } from '../../lib/connectionStatus';
import * as serverAPI from '../../lib/server';
import * as session from '../../lib/session';
import * as sharesAPI from '../../lib/shares';
import useTransferRates from '../../lib/useTransferRates';
import { formatBitrate, formatBytes } from '../../lib/util';
import MetadataLookupWatcher from '../MetadataLookup/MetadataLookupWatcher';
import ResonanceMark from '../Shared/ResonanceMark';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Cpu,
  FolderOpen,
  Globe,
  HardDrive,
  ImageUp,
  Loader2,
  LogOut,
  Moon,
  Plug,
  PlugZap,
  RefreshCw,
  Star,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

const readCachedStatus = (key, fallback) => {
  try {
    const value = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

const cacheStatus = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.removeItem(key);
  } catch {
    /* Status caching is only a rendering optimisation. */
  }
};

const StatusStrip = ({
  brand,
  disk,
  downloads,
  isLoggedIn,
  networkInfo,
  onConnect,
  onDisconnect,
  onLogout,
  queuedTransferCount,
  queuedTransferCounts,
  server,
  shares,
  system,
  uploads,
  upnp,
  user,
  viewControls,
}) => {
  const cachedProfile = readCachedStatus('resonance-status-profile', {});
  const [rescanning, setRescanning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [presence, setPresence] = useState(
    () => cachedProfile.presence ?? 'Online',
  );
  const [description, setDescription] = useState(
    () => cachedProfile.description ?? '',
  );
  const [descDraft, setDescDraft] = useState(
    () => cachedProfile.description ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [portStatus, setPortStatus] = useState(() =>
    readCachedStatus('resonance-status-port', null),
  );
  const [hasPicture, setHasPicture] = useState(() =>
    Boolean(cachedProfile.hasPicture),
  );
  // bumped after every picture change to bust the browser cache of the fixed picture URL
  const [pictureVersion, setPictureVersion] = useState(0);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const pictureInputRef = useRef(null);
  const detailsRef = useRef(null);

  useEffect(() => {
    const closeDetails = (event) => {
      const details = detailsRef.current;
      if (!details?.open) return;
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return;
        details.removeAttribute('open');
        details.querySelector('summary')?.focus();
      } else if (!details.contains(event.target)) {
        details.removeAttribute('open');
      }
    };

    document.addEventListener('pointerdown', closeDetails);
    document.addEventListener('keydown', closeDetails);
    return () => {
      document.removeEventListener('pointerdown', closeDetails);
      document.removeEventListener('keydown', closeDetails);
    };
  }, []);

  const rates = useTransferRates(downloads, uploads);

  useEffect(() => {
    if (!isLoggedIn) return;
    session
      .getStatus()
      .then(({ description: d, hasPicture: hp, presence: p }) => {
        cacheStatus('resonance-status-profile', {
          description: d ?? '',
          hasPicture: Boolean(hp),
          presence: p ?? 'Online',
        });
        setPresence(p ?? 'Online');
        setDescription(d ?? '');
        setDescDraft(d ?? '');
        setHasPicture(Boolean(hp));
      })
      .catch(() => {});
  }, [isLoggedIn]);

  useEffect(() => {
    cacheStatus('resonance-status-profile', {
      description,
      hasPicture,
      presence,
    });
  }, [description, hasPicture, presence]);

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
    // The remote probe can take several seconds. Always expose that it has
    // started instead of leaving a cached result on screen with no activity.
    setPortStatus('checking');
    try {
      const result = await serverAPI.checkPort();
      setPortStatus(result);
      cacheStatus('resonance-status-port', result);
    } catch {
      setPortStatus('error');
    }
  };

  // Check the listening port once the client is logged in to the network.
  useEffect(() => {
    if (server && !server.isLoggedIn) {
      setPortStatus(null);
      return;
    }

    if (!server) return;

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

  const handlePictureSelected = async (e) => {
    const file = e.target.files?.[0];
    // reset the input so selecting the same file again still fires onChange
    e.target.value = '';
    if (!file) return;

    setUploadingPicture(true);
    try {
      await serverAPI.uploadPicture(file);
      setHasPicture(true);
      setPictureVersion((v) => v + 1);
      toast.success('Profile photo updated');
    } catch {
      toast.error('Failed to upload profile photo');
    } finally {
      setUploadingPicture(false);
    }
  };

  const handleRemovePicture = async () => {
    setUploadingPicture(true);
    try {
      await serverAPI.deletePicture();
      setHasPicture(false);
      setPictureVersion((v) => v + 1);
      toast.success('Profile photo removed');
    } catch {
      toast.error('Failed to remove profile photo');
    } finally {
      setUploadingPicture(false);
    }
  };

  // A UPnP mapping made against the router's own WAN IP means nothing if that IP
  // isn't actually the address the internet sees us as (carrier-grade NAT) — in
  // that case a live "port open" reading from a single third-party probe can be
  // a fluke, so don't present it as trustworthy.
  const cgnatMismatch = Boolean(
    upnp?.isMapped &&
      networkInfo?.ip &&
      upnp?.externalIPAddress &&
      networkInfo.ip !== upnp.externalIPAddress,
  );

  const isConnected = server?.isLoggedIn;

  const connection = connectionStatus(server, shares);
  const connPhase = connection.label;
  const connBusy = connection.busy;

  const username = user?.username;
  const isPrivileged = user?.privileges?.isPrivileged;
  // The Soulseek server reports privileges as seconds remaining, not days.
  const privilegeSeconds = user?.privileges?.privilegesRemaining;
  const fileCount = shares?.files ?? 0;
  const directoryCount = shares?.directories ?? 0;
  const scanning = shares?.scanning;
  const scanPct = Math.round((shares?.scanProgress ?? 0) * 100);
  const scanPending = shares?.scanPending;

  const queuedCount =
    Number.isSafeInteger(queuedTransferCount) && queuedTransferCount >= 0
      ? queuedTransferCount
      : (Array.isArray(downloads)
          ? downloads.filter(
              (t) => t.state?.startsWith('Queued') || t.state === 'Requested',
            ).length
          : 0) +
        (Array.isArray(uploads)
          ? uploads.filter(
              (t) => t.state?.startsWith('Queued') || t.state === 'Requested',
            ).length
          : 0);
  const dlSpeed = rates.down;
  const ulSpeed = rates.up;

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

      {/* Identity + connection — one control. The button leads with the
          connection icon and opens a menu that includes connect/disconnect. */}
      {isLoggedIn && (
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
            title={
              isConnected
                ? 'Connected to Soulseek'
                : connection.detail || connPhase
            }
            type="button"
          >
            {/* Connection status indicator */}
            {connBusy ? (
              <Loader2
                className="status-icon status-spin"
                size={13}
                strokeWidth={2}
              />
            ) : isConnected ? (
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

            {isConnected && username ? (
              <>
                <span className="status-avatar">
                  {hasPicture ? (
                    <img
                      alt=""
                      className="status-avatar-img"
                      src={serverAPI.pictureUrl(pictureVersion)}
                    />
                  ) : (
                    <ResonanceMark size={16} />
                  )}
                  <span
                    className={`status-avatar-presence${presence === 'Away' ? ' away' : presenceColor ? ' online' : ' offline'}`}
                  />
                </span>
                <span className="status-strip-text">{username}</span>
                {description && (
                  <span
                    className="status-chip status-comment-chip"
                    title={description}
                  >
                    {description}
                  </span>
                )}
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
              </>
            ) : (
              <span className="status-strip-text status-strip-muted">
                {connPhase}
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
                <div className="status-menu-section">Connection</div>
                <button
                  className="status-menu-item status-menu-toggle"
                  onClick={() => {
                    if (isConnected) onDisconnect?.();
                    else onConnect?.();
                    setMenuOpen(false);
                    setMenuPos(null);
                  }}
                  type="button"
                >
                  {connBusy ? (
                    <Loader2
                      className="status-icon status-spin"
                      size={13}
                      strokeWidth={2}
                    />
                  ) : isConnected ? (
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
                  Soulseek
                  <span
                    className={`status-toggle-switch${isConnected ? ' on' : ''}`}
                  >
                    <span className="status-toggle-knob" />
                  </span>
                </button>

                {isConnected && (
                  <>
                    <div className="status-menu-divider" />
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

                    <div className="status-menu-divider" />
                    <div className="status-menu-section">Profile photo</div>
                    <div className="status-menu-photo-row">
                      <span className="status-menu-photo-preview">
                        {hasPicture ? (
                          <img
                            alt=""
                            src={serverAPI.pictureUrl(pictureVersion)}
                          />
                        ) : (
                          <ResonanceMark size={22} />
                        )}
                      </span>
                      <input
                        accept="image/*"
                        onChange={handlePictureSelected}
                        ref={pictureInputRef}
                        style={{ display: 'none' }}
                        type="file"
                      />
                      <button
                        className="status-menu-photo-btn"
                        disabled={uploadingPicture}
                        onClick={() => pictureInputRef.current?.click()}
                        type="button"
                      >
                        {uploadingPicture ? (
                          <Loader2
                            className="status-spin"
                            size={12}
                          />
                        ) : (
                          <ImageUp size={12} />
                        )}
                        {hasPicture ? 'Change' : 'Upload'}
                      </button>
                      {hasPicture && (
                        <button
                          className="status-menu-photo-btn danger"
                          disabled={uploadingPicture}
                          onClick={handleRemovePicture}
                          type="button"
                        >
                          <Trash2 size={12} />
                          Remove
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>,
              document.body,
            )}
        </div>
      )}

      {scanning && (
        <span
          className="status-chip scanning status-scan-summary"
          role="status"
        >
          <Loader2
            className="status-spin"
            size={12}
          />
          Scanning shares{scanPct > 0 ? ` · ${scanPct}%` : ''}
        </span>
      )}
      {disk?.downloadsBlocked && (
        <span className="status-chip danger">
          Downloads paused · low disk space
        </span>
      )}
      <div className="status-strip-spacer" />
      {queuedTransferCounts ? (
        <>
          <a
            className="status-chip"
            href={`${urlBase}/uploads`}
          >
            {queuedTransferCounts.uploads.toLocaleString()} uploads waiting
          </a>
          <a
            className="status-chip"
            href={`${urlBase}/downloads`}
          >
            {queuedTransferCounts.downloads.toLocaleString()} downloads waiting
          </a>
        </>
      ) : (
        queuedCount > 0 && (
          <span className="status-chip">{queuedCount} transfers queued</span>
        )
      )}
      {(dlSpeed > 0 || ulSpeed > 0) && (
        <span className="status-live-rates">
          <ArrowDown size={12} /> {formatBitrate(dlSpeed)}
          <ArrowUp size={12} /> {formatBitrate(ulSpeed)}
        </span>
      )}
      {isLoggedIn && <MetadataLookupWatcher />}
      {viewControls && (
        <div className="status-strip-view-controls">
          <span className="status-strip-view-label">Display size</span>
          {viewControls}
        </div>
      )}
      <details
        className="status-details"
        ref={detailsRef}
      >
        <summary>
          Status & controls <ChevronDown size={13} />
        </summary>
        <div className="status-details-panel">
          <div className="status-details-heading">Server status</div>
          {/* Listening port reachability */}
          {isConnected && portStatus && (
            <>
              <div className="status-details-label">
                Incoming Soulseek connections
              </div>
              <button
                className="status-strip-btn status-strip-btn--label"
                disabled={portStatus === 'checking'}
                onClick={runPortCheck}
                title={
                  portStatus === 'checking'
                    ? 'Checking listening port…'
                    : portStatus === 'error'
                      ? 'Port check failed — click to retry'
                      : portStatus.isOpen && cgnatMismatch
                        ? `The port test reported port ${portStatus.port} open, but your router's UPnP-mapped IP (${upnp.externalIPAddress}) differs from your internet-facing IP (${networkInfo.ip}) — likely carrier-grade NAT. That single-probe "open" result can't be trusted; incoming connections are probably still unreachable. Click to re-check.`
                        : `Listening port ${portStatus.port} is ${portStatus.isOpen ? 'open (reachable)' : 'closed (not reachable from the internet)'} — click to re-check`
                }
                type="button"
              >
                {portStatus.isOpen && cgnatMismatch ? (
                  <Plug
                    className="status-icon status-icon--warning"
                    size={13}
                    strokeWidth={1.75}
                  />
                ) : portStatus.isOpen ? (
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
                    ? 'Checking port…'
                    : portStatus === 'error'
                      ? 'Check failed — retry'
                      : portStatus.isOpen
                        ? cgnatMismatch
                          ? 'Reachability uncertain'
                          : 'Reachable — check again'
                        : 'Not reachable — check again'}
                </span>
              </button>
            </>
          )}

          <div className="status-strip-sep" />

          <div className="status-details-label">Shared collection</div>
          <div className="status-strip-item status-strip-item--shares">
            <FolderOpen
              className="status-icon"
              size={13}
              strokeWidth={1.75}
            />
            <span className="status-strip-text">
              {fileCount.toLocaleString()} files
              {directoryCount > 0 &&
                `, ${directoryCount.toLocaleString()} folders`}
            </span>
            {scanPending && !scanning && (
              <span className="status-chip pending">Pending</span>
            )}
            <button
              aria-label="Rescan shared files"
              className="status-strip-btn"
              disabled={scanning || rescanning}
              onClick={handleRescan}
              title="Rescan shared files"
              type="button"
            >
              <RefreshCw
                className={scanning || rescanning ? 'spinning' : ''}
                size={12}
                strokeWidth={1.75}
              />
              <span>{scanning || rescanning ? 'Scanning…' : 'Rescan'}</span>
            </button>
          </div>

          <div className="status-strip-sep" />
          <div className="status-details-label">Waiting transfers</div>
          <div className="status-strip-item status-strip-item--queue">
            <span className="status-strip-text">
              {queuedCount > 0
                ? `${queuedCount} queued`
                : 'No transfers waiting'}
            </span>
          </div>

          <div className="status-strip-sep" />
          <div className="status-details-label">Current transfer speed</div>
          <div className="status-strip-item status-strip-item--rates">
            <ArrowDown
              className="status-icon"
              size={12}
              strokeWidth={1.75}
            />
            <span className="status-strip-text status-strip-speed">
              Download: {formatBitrate(dlSpeed)}
            </span>
            <ArrowUp
              className="status-icon"
              size={12}
              strokeWidth={1.75}
            />
            <span className="status-strip-text status-strip-speed">
              Upload: {formatBitrate(ulSpeed)}
            </span>
          </div>

          {/* Free disk space on the downloads volume */}
          {disk?.totalBytes > 0 && (
            <>
              <div className="status-strip-sep" />
              <div className="status-details-label">Download storage</div>
              <div
                className="status-strip-item status-strip-item--disk"
                title={
                  disk.downloadsBlocked
                    ? 'Downloads paused — free space is below the safe limit'
                    : `${formatBytes(disk.availableBytes)} free of ${formatBytes(disk.totalBytes)} on the downloads volume`
                }
              >
                <HardDrive
                  className={`status-icon${disk.downloadsBlocked ? ' disconnected' : ''}`}
                  size={13}
                  strokeWidth={1.75}
                />
                <span className="status-strip-text">
                  {formatBytes(disk.availableBytes)} free of{' '}
                  {formatBytes(disk.totalBytes)}
                </span>
                {disk.downloadsBlocked && (
                  <span className="status-chip danger">Downloads paused</span>
                )}
              </div>
            </>
          )}

          {/* Host CPU and memory */}
          {system?.hostMemoryTotalBytes > 0 && (
            <>
              <div className="status-strip-sep" />
              <div className="status-details-label">Server resources</div>
              <div
                className="status-strip-item status-strip-item--system"
                title={`Host: ${formatBytes(system.hostMemoryUsedBytes)} of ${formatBytes(system.hostMemoryTotalBytes)} memory in use`}
              >
                <Cpu
                  className="status-icon"
                  size={13}
                  strokeWidth={1.75}
                />
                <span className="status-strip-text">
                  CPU:{' '}
                  {system.hostCpuPercent == null
                    ? '—'
                    : `${system.hostCpuPercent.toFixed(0)}%`}{' '}
                  · Memory: {formatBytes(system.hostMemoryUsedBytes)} of{' '}
                  {formatBytes(system.hostMemoryTotalBytes)}
                </span>
              </div>
            </>
          )}

          {networkInfo && (
            <>
              <div className="status-strip-sep" />
              <div className="status-details-label">
                Server public IP address
              </div>
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
              </div>
            </>
          )}

          {isLoggedIn && onLogout && (
            <>
              <div className="status-strip-sep" />
              <div className="status-details-heading">Your session</div>
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
      </details>
    </div>
  );
};

export default StatusStrip;
