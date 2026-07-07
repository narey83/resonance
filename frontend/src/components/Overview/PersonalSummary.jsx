// <copyright file="PersonalSummary.jsx" company="John Narey">
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

// Non-admin landing page: a small, role-appropriate summary instead of the
// full analytics dashboard (which stays Administrator-only, both for its
// own sensitivity and because most of its endpoints are role-gated on the
// backend). Everything here is either already-open data (GET /application)
// or the caller's own transfer summary (backend enforces self-or-admin on
// that endpoint — see ReportsController.GetTransferSummary).

import * as reportsAPI from '../../lib/reports';
import { getRole, getTokenExpiry, getUsername } from '../../lib/token';
import { formatBytes } from '../../lib/util';
import React, { useEffect, useState } from 'react';

const sumBytes = (directionData) =>
  Object.values(directionData ?? {}).reduce(
    (s, v) => s + (v.totalBytes ?? 0),
    0,
  );

const sumCount = (directionData) =>
  Object.values(directionData ?? {}).reduce((s, v) => s + (v.count ?? 0), 0);

const succeededCount = (directionData) =>
  (directionData?.Succeeded ?? directionData?.succeeded)?.count ?? 0;

// Handles both past ("Xm ago") and future ("in Xm") timestamps.
const formatRelative = (epochMs) => {
  if (!epochMs) return '—';
  const diffMs = Date.now() - epochMs;
  const future = diffMs < 0;
  const diffMin = Math.abs(diffMs) / 60_000;
  if (diffMin < 1) return 'just now';
  const unit = (n, u) => (future ? `in ${n}${u}` : `${n}${u} ago`);
  if (diffMin < 60) return unit(Math.floor(diffMin), 'm');
  if (diffMin < 60 * 24) return unit(Math.floor(diffMin / 60), 'h');
  if (diffMin < 60 * 24 * 30) return unit(Math.floor(diffMin / (60 * 24)), 'd');
  return new Date(epochMs).toLocaleDateString();
};

const Tile = ({ label, sub, value, valueColor }) => (
  <div className="kpi-card">
    <div className="kpi-card-label">{label}</div>
    <div
      className="kpi-card-value"
      style={valueColor ? { color: valueColor } : undefined}
    >
      {value}
    </div>
    <div
      className="kpi-card-sub"
      style={{ visibility: sub ? 'visible' : 'hidden' }}
    >
      {sub || ' '}
    </div>
  </div>
);

const PersonalSummary = ({ state }) => {
  const [summary, setSummary] = useState(null);
  const [latencyMs, setLatencyMs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const username = getUsername();
    if (!username) return undefined;

    let cancelled = false;
    const startedAt = performance.now();
    reportsAPI
      .getSummary({ username })
      .then((data) => {
        if (cancelled) return;
        setLatencyMs(Math.round(performance.now() - startedAt));
        setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your activity summary.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const dl = summary?.Download ?? summary?.download ?? {};
  const ul = summary?.Upload ?? summary?.upload ?? {};
  const dlBytes = sumBytes(dl);
  const ulBytes = sumBytes(ul);
  const totalCount = sumCount(dl) + sumCount(ul);
  const totalSucceeded = succeededCount(dl) + succeededCount(ul);
  const successRate =
    totalCount > 0
      ? `${((totalSucceeded / totalCount) * 100).toFixed(1)}%`
      : '—';

  const secure = window.location.protocol === 'https:';
  const tokenExpiry = getTokenExpiry();

  return (
    <div className="overview-section">
      <h3 className="overview-section-title">My Activity (last 7 days)</h3>
      {error ? (
        <p style={{ color: 'var(--text-muted)' }}>{error}</p>
      ) : (
        <div className="kpi-cards">
          <Tile
            label="Downloaded"
            value={summary ? formatBytes(dlBytes) : '—'}
          />
          <Tile
            label="Uploaded"
            value={summary ? formatBytes(ulBytes) : '—'}
          />
          <Tile
            label="Transfers"
            sub={summary ? successRate + ' success' : undefined}
            value={summary ? totalCount.toLocaleString() : '—'}
          />
        </div>
      )}

      <h3 className="overview-section-title">Session</h3>
      <div className="kpi-cards">
        <Tile
          label="Connected To"
          value={window.location.host}
        />
        <Tile
          label="Security"
          sub={
            secure
              ? 'Certificate verified by browser'
              : 'Traffic is not encrypted'
          }
          value={secure ? 'Secure (HTTPS)' : 'Insecure (HTTP)'}
          valueColor={secure ? 'var(--success)' : 'var(--danger)'}
        />
        <Tile
          label="Latency"
          value={latencyMs != null ? `${latencyMs} ms` : '—'}
        />
        <Tile
          label="Role"
          value={getRole() ?? '—'}
        />
        <Tile
          label="Token Expires"
          value={formatRelative(tokenExpiry)}
        />
      </div>

      <h3 className="overview-section-title">My Library</h3>
      <div className="kpi-cards">
        <Tile
          label="Directories"
          value={(state?.shares?.directories ?? 0).toLocaleString()}
        />
        <Tile
          label="Files"
          value={(state?.shares?.files ?? 0).toLocaleString()}
        />
        <Tile
          label="Scan"
          value={
            state?.shares?.scanning
              ? 'Scanning…'
              : state?.shares?.scanPending
                ? 'Pending'
                : state?.shares?.faulted
                  ? 'Faulted'
                  : state?.shares?.ready
                    ? 'Ready'
                    : 'Unknown'
          }
        />
      </div>
    </div>
  );
};

export default PersonalSummary;
