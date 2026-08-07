// <copyright file="index.jsx" company="JP Dillingham">
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

import {
  collectGarbage,
  getDumpUrl,
  getVersion,
  loopback,
  restart,
  shutdown,
} from '../../../lib/application';
import * as metricsAPI from '../../../lib/metrics';
import * as sessionAPI from '../../../lib/session';
import { getSessionId } from '../../../lib/token';
import { parseUtcDate } from '../../../lib/util';
import {
  Globe,
  Monitor,
  Power,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Star,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const Badge = ({ label, ok }) => (
  <span className={`info-badge info-badge--${ok ? 'ok' : 'warn'}`}>
    {label}
  </span>
);

const Field = ({ description, label, value }) => (
  <div className="info-field">
    <div className="info-field-label">{label}</div>
    <div className="info-field-right">
      <div className="info-field-value">
        {value ?? <span className="info-field-empty">—</span>}
      </div>
      {description && <div className="info-field-desc">{description}</div>}
    </div>
  </div>
);

const Section = ({ children, fullWidth, title }) => (
  <div className={`info-section${fullWidth ? ' info-section--full' : ''}`}>
    <div className="info-section-title">{title}</div>
    <div className="info-section-body">{children}</div>
  </div>
);

const formatBytes = (bytes) => {
  if (bytes == null) return '—';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const formatPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

// The Soulseek server reports privileges as seconds remaining (protocol
// CheckPrivileges), not days. Render the largest sensible unit.
const formatPrivileges = (seconds) => {
  if (seconds == null) return '—';
  if (seconds >= 86_400) return plural(Math.floor(seconds / 86_400), 'day');
  if (seconds >= 3_600) return plural(Math.floor(seconds / 3_600), 'hour');
  if (seconds >= 60) return plural(Math.floor(seconds / 60), 'minute');
  return plural(seconds, 'second');
};

const kpiValue = (kpis, name) => kpis?.[name]?.value ?? null;

const DeviceIcon = ({ name }) => {
  const n = (name || '').toLowerCase();
  if (/iphone|ipad|android|pixel|mobile/.test(n))
    return <Smartphone size={14} />;
  if (/browser/.test(n)) return <Globe size={14} />;
  return <Monitor size={14} />;
};

const relTime = (iso) => {
  if (!iso) return null;
  const diff = Date.now() - parseUtcDate(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

const SessionsPanel = () => {
  const [sessions, setSessions] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [error, setError] = useState(null);
  const mySessionId = getSessionId();
  // Shared by the mount effect and the revoke handlers, so a per-effect
  // cancelled flag can't cover every caller — guard setState with a ref
  // that flips on unmount.
  const mountedRef = useRef(true);

  const load = async () => {
    try {
      const data = await sessionAPI.getSessions();
      if (mountedRef.current) setSessions(data);
    } catch {
      if (mountedRef.current) setError('Failed to load sessions');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRevoke = async (id) => {
    setRevoking(id);
    try {
      await sessionAPI.revokeSession(id);
      if (id === mySessionId) {
        await sessionAPI.logout();
        window.location.reload();
        return;
      }

      await load();
    } catch {
      if (mountedRef.current) setError('Failed to revoke session');
    } finally {
      if (mountedRef.current) setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevoking('all');
    try {
      await sessionAPI.revokeAllSessions();
      await sessionAPI.logout();
      window.location.reload();
    } catch {
      if (mountedRef.current) {
        setError('Failed to revoke all sessions');
        setRevoking(null);
      }
    }
  };

  return (
    <Section
      fullWidth
      title="Active Sessions"
    >
      {error && (
        <div
          className="opt-error"
          style={{ margin: '10px 14px 0' }}
        >
          {error}
        </div>
      )}
      {sessions && sessions.length > 0 && (
        <div className="session-toolbar">
          <button
            className="shares-add-btn shares-add-btn--danger hover-fx"
            disabled={revoking === 'all'}
            onClick={handleRevokeAll}
            type="button"
          >
            {revoking === 'all' ? 'Revoking…' : 'Revoke All Sessions'}
          </button>
        </div>
      )}
      {sessions === null ? (
        <div className="session-empty">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="session-empty">No active sessions</div>
      ) : (
        sessions.map((s) => {
          return (
            <div
              className={`session-row${s.id === mySessionId ? ' session-row--current' : ''}`}
              key={s.id}
            >
              <span className="session-row-icon">
                <DeviceIcon name={s.deviceName} />
              </span>
              <div className="session-row-body">
                <div className="session-row-device">
                  {s.deviceName || (
                    <em style={{ opacity: 0.5 }}>Unknown device</em>
                  )}
                  {s.deviceId && (
                    <span className="session-browser-id">
                      #{s.deviceId.slice(0, 8)}
                    </span>
                  )}
                  {s.id === mySessionId && (
                    <span className="session-badge">current</span>
                  )}
                </div>
                <div className="session-row-meta">
                  {s.ipAddress && (
                    <span style={{ fontFamily: 'monospace' }}>
                      {s.ipAddress}
                    </span>
                  )}
                  {s.lastUsedAt && <span>Active {relTime(s.lastUsedAt)}</span>}
                  {s.createdAt && (
                    <span>
                      Since {parseUtcDate(s.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                className="shares-add-btn shares-add-btn--danger"
                disabled={revoking === s.id}
                onClick={() => handleRevoke(s.id)}
                type="button"
              >
                {revoking === s.id
                  ? 'Revoking…'
                  : s.id === mySessionId
                    ? 'Log Out'
                    : 'Revoke'}
              </button>
            </div>
          );
        })
      )}
    </Section>
  );
};

const KpiPanel = () => {
  const [kpis, setKpis] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await metricsAPI.getKpis();
        if (!cancelled) setKpis(data);
      } catch {
        // metrics may not be available in all deployments
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!kpis) return null;

  const workingSet = kpiValue(kpis, 'process_working_set_bytes');
  const managedMem = kpiValue(kpis, 'dotnet_total_memory_bytes');
  const cpuUsage = kpiValue(kpis, 'system_runtime_cpu_usage');
  const tcpConns = kpiValue(kpis, 'system_net_sockets_established_total');
  const diskFree = kpiValue(kpis, 'node_filesystem_avail_bytes');

  if (
    ![workingSet, managedMem, cpuUsage, tcpConns, diskFree].some(
      (v) => v != null,
    )
  )
    return null;

  return (
    <Section title="System Resources">
      {workingSet != null && (
        <Field
          description="Total memory used by the process (working set)"
          label="Working Set"
          value={formatBytes(workingSet)}
        />
      )}
      {managedMem != null && (
        <Field
          description=".NET managed heap memory"
          label="Managed Memory"
          value={formatBytes(managedMem)}
        />
      )}
      {cpuUsage != null && (
        <Field
          description="CPU usage by the process"
          label="CPU Usage"
          value={formatPct(cpuUsage)}
        />
      )}
      {tcpConns != null && (
        <Field
          description="Active TCP socket connections"
          label="TCP Connections"
          value={String(tcpConns)}
        />
      )}
      {diskFree != null && (
        <Field
          description="Available disk space"
          label="Disk Free"
          value={formatBytes(diskFree)}
        />
      )}
    </Section>
  );
};

const Info = ({ state }) => {
  const {
    pendingReconnect,
    pendingRestart,
    relay = {},
    server = {},
    shares = {},
    user = {},
    version = {},
  } = state;

  const [gcWorking, setGcWorking] = useState(false);
  const [loopbackResult, setLoopbackResult] = useState(null);
  const [loopbackWorking, setLoopbackWorking] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const { controller, mode } = relay;
  const { scanPending } = shares;
  const { current, isCanary, isUpdateAvailable, latest } = version;

  const handleGc = async () => {
    setGcWorking(true);
    try {
      await collectGarbage();
    } finally {
      setGcWorking(false);
    }
  };

  const handleLoopback = async () => {
    setLoopbackWorking(true);
    setLoopbackResult(null);
    const start = Date.now();
    try {
      await loopback();
      setLoopbackResult({ ok: true, ms: Date.now() - start });
    } catch {
      setLoopbackResult({ ok: false });
    } finally {
      setLoopbackWorking(false);
    }
  };

  return (
    <>
      {confirm && (
        <div
          className="confirm-overlay"
          onClick={() => setConfirm(null)}
        >
          <div
            className="confirm-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-box-title">
              {confirm === 'shutdown' ? 'Shut Down' : 'Restart Application'}
            </div>
            <div className="confirm-box-message">
              {confirm === 'shutdown'
                ? "This will stop the application. You'll need to manually restart it."
                : 'Are you sure you want to restart the application?'}
            </div>
            <div className="confirm-box-actions">
              <button
                className="shares-add-btn"
                onClick={() => setConfirm(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={`shares-add-btn shares-add-btn--${confirm === 'shutdown' ? 'danger' : 'warn'}`}
                onClick={() => {
                  if (confirm === 'shutdown') shutdown();
                  else restart();
                  setConfirm(null);
                }}
                type="button"
              >
                {confirm === 'shutdown' ? 'Shut Down' : 'Restart'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="info-actions">
        <div className="info-actions-left">
          <button
            className="info-action-btn hover-fx"
            onClick={() => getVersion({ forceCheck: true })}
            type="button"
          >
            <RefreshCw size={13} />
            Check for Updates
          </button>
          <button
            className="info-action-btn hover-fx"
            onClick={() =>
              window.open(
                `http://www.slsknet.org/qtlogin.php?username=${user?.username}`,
                '_blank',
              )
            }
            type="button"
          >
            <Star size={13} />
            Get Privileges
          </button>
        </div>
        <div className="info-actions-right">
          <button
            className={`info-action-btn info-action-btn--warn hover-fx${pendingRestart ? ' info-action-btn--warn-active' : ''}`}
            onClick={() => setConfirm('restart')}
            type="button"
          >
            <RotateCcw size={13} />
            Restart
          </button>
          <button
            className="info-action-btn info-action-btn--danger hover-fx"
            onClick={() => setConfirm('shutdown')}
            type="button"
          >
            <Power size={13} />
            Shut Down
          </button>
        </div>
      </div>

      <div className="info-grid">
        <Section title="Application">
          <Field
            description="The currently installed version of Resonance"
            label="Running Version"
            value={current}
          />
          <Field
            description="Most recent publicly available release"
            label="Latest Release"
            value={latest}
          />
          <Field
            description="Whether a newer version is available to download"
            label="Update Status"
            value={
              isUpdateAvailable ===
              undefined ? undefined : isUpdateAvailable ? (
                <Badge
                  label="Update available"
                  ok={false}
                />
              ) : (
                <Badge
                  label="Up to date"
                  ok
                />
              )
            }
          />
          <Field
            description="Canary builds receive features earlier but may be less stable"
            label="Build Channel"
            value={
              isCanary === undefined ? undefined : isCanary ? (
                <Badge
                  label="Canary"
                  ok={false}
                />
              ) : (
                'Stable'
              )
            }
          />
        </Section>

        <Section title="Server Connection">
          <Field
            description="Whether the app is connected to the Soulseek network"
            label="Status"
            value={
              server?.isConnected ===
              undefined ? undefined : server.isConnected ? (
                <Badge
                  label="Connected"
                  ok
                />
              ) : (
                <Badge
                  label="Disconnected"
                  ok={false}
                />
              )
            }
          />
          <Field
            description="IP address of the active Soulseek server"
            label="Server Address"
            value={server?.address}
          />
          <Field
            description="The Soulseek username this instance is signed in as"
            label="Account"
            value={server?.username ?? user?.username}
          />
          {(pendingReconnect || pendingRestart) && (
            <Field
              description="A configuration change requires the app to restart or reconnect before taking effect"
              label="Pending Action"
              value={
                pendingRestart ? (
                  <Badge
                    label="Restart required"
                    ok={false}
                  />
                ) : (
                  <Badge
                    label="Reconnect required"
                    ok={false}
                  />
                )
              }
            />
          )}
        </Section>

        <Section title="User">
          <Field
            description="Soulseek privileges remaining — grants priority in other users' upload queues"
            label="Privileges"
            value={
              user?.privileges === undefined ? undefined : user.privileges
                  .isPrivileged ? (
                formatPrivileges(user.privileges.privilegesRemaining)
              ) : (
                <Badge
                  label="None"
                  ok={false}
                />
              )
            }
          />
        </Section>

        <Section title="Shares">
          <Field
            description="Whether shared folders need to be re-scanned to reflect filesystem changes"
            label="Scan Status"
            value={
              scanPending === undefined ? undefined : scanPending ? (
                <Badge
                  label="Scan pending"
                  ok={false}
                />
              ) : (
                <Badge
                  label="Up to date"
                  ok
                />
              )
            }
          />
        </Section>

        {mode && (
          <Section title="Relay">
            <Field
              description="How this instance participates in the relay network — Independent, Agent, or Controller"
              label="Mode"
              value={mode}
            />
            {controller && (
              <Field
                description="Connection state to the relay controller"
                label="Controller"
                value={controller?.state}
              />
            )}
          </Section>
        )}

        <KpiPanel />

        <SessionsPanel />

        <Section
          fullWidth
          title="Admin"
        >
          <div className="info-field">
            <div className="info-field-label">Garbage Collection</div>
            <div className="info-field-right">
              <div className="info-field-value">
                <button
                  className="shares-add-btn"
                  disabled={gcWorking}
                  onClick={handleGc}
                  type="button"
                >
                  {gcWorking ? 'Running…' : 'Run GC'}
                </button>
              </div>
              <div className="info-field-desc">
                Force a .NET garbage collection pass to reclaim managed memory.
              </div>
            </div>
          </div>
          <div className="info-field">
            <div className="info-field-label">Loopback Test</div>
            <div className="info-field-right">
              <div
                className="info-field-value"
                style={{ alignItems: 'center', display: 'flex', gap: 8 }}
              >
                <button
                  className="shares-add-btn"
                  disabled={loopbackWorking}
                  onClick={handleLoopback}
                  type="button"
                >
                  {loopbackWorking ? 'Testing…' : 'Test'}
                </button>
                {loopbackResult && (
                  <span
                    style={{
                      color: loopbackResult.ok
                        ? 'var(--success)'
                        : 'var(--danger)',
                      fontSize: 12,
                    }}
                  >
                    {loopbackResult.ok
                      ? `OK (${loopbackResult.ms} ms)`
                      : 'Failed'}
                  </span>
                )}
              </div>
              <div className="info-field-desc">
                Send a round-trip request to verify backend connectivity.
              </div>
            </div>
          </div>
          <div className="info-field">
            <div className="info-field-label">Memory Dump</div>
            <div className="info-field-right">
              <div className="info-field-value">
                <a
                  className="shares-add-btn"
                  download="resonance.dmp"
                  href={getDumpUrl()}
                  style={{ display: 'inline-block', textDecoration: 'none' }}
                >
                  Download Dump
                </a>
              </div>
              <div className="info-field-desc">
                Download a process memory dump for diagnostics. Large file — may
                take a moment.
              </div>
            </div>
          </div>
        </Section>

        <Section
          fullWidth
          title="License & Attribution"
        >
          <div
            className="info-field-desc"
            style={{ lineHeight: 1.6, padding: '4px 14px 12px' }}
          >
            Resonance is a modified version of{' '}
            <a
              href="https://github.com/slskd/slskd"
              rel="noreferrer"
              target="_blank"
            >
              slskd
            </a>
            . It is not maintained by, endorsed by, or affiliated with the slskd
            project or its author(s). Resonance is free software licensed under
            the{' '}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              rel="noreferrer"
              target="_blank"
            >
              GNU Affero General Public License v3.0
            </a>{' '}
            with additional terms. The complete source code corresponding to
            this running version is available at{' '}
            <a
              href="https://github.com/narey83/resonance"
              rel="noreferrer"
              target="_blank"
            >
              github.com/narey83/resonance
            </a>
            .
          </div>
        </Section>
      </div>
    </>
  );
};

export default Info;
