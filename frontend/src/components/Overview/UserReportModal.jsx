// <copyright file="UserReportModal.jsx" company="John Narey">
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

import * as reportsAPI from '../../lib/reports';
import { formatBytes, formatDate, getFileName } from '../../lib/util';
import UsernameLink from '../Shared/UsernameLink';
import { ExternalLink } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Header, Modal } from 'semantic-ui-react';

const PAGE_SIZE = 25;

const formatSpeed = (speed) => (speed > 0 ? `${formatBytes(speed)}/s` : '—');

// Show only the immediate parent folder, dropping the share-root segments
// (e.g. "music\") — matches the Uploads/Downloads tables.
const leafFolder = (fullPath) =>
  fullPath.split(/[/\\]/u).filter(Boolean).slice(0, -1).at(-1) ?? '';

const STATE_COLORS = {
  Succeeded: 'var(--success)',
  Errored: 'var(--danger)',
  TimedOut: 'var(--danger)',
  Rejected: 'var(--warning)',
  Aborted: 'var(--warning)',
  Cancelled: 'var(--text-muted)',
};

const stateColor = (desc) => {
  for (const [key, color] of Object.entries(STATE_COLORS)) {
    if (desc && desc.includes(key)) return color;
  }

  return 'var(--text-muted)';
};

const OverviewTab = ({ detail, loading }) => {
  if (loading) return <div className="user-report-loading">Loading…</div>;
  if (!detail) return <div className="user-report-empty">No transfer data</div>;

  const renderDir = (label, data) => {
    if (!data) return null;
    const stats = data.statistics ?? {};
    const succeeded =
      (data.summary ?? {}).Succeeded ?? (data.summary ?? {}).succeeded;
    return (
      <div className="user-report-dir-block">
        <div className="user-report-dir-label">{label}s</div>
        <div className="user-detail-grid">
          <div className="user-detail-stat">
            <span className="user-detail-stat-label">Total</span>
            <span className="user-detail-stat-value">
              {(stats.total ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="user-detail-stat">
            <span className="user-detail-stat-label">Successful</span>
            <span className="user-detail-stat-value">
              {(stats.successful ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="user-detail-stat">
            <span className="user-detail-stat-label">Errors</span>
            <span
              className="user-detail-stat-value"
              style={{ color: stats.errored > 0 ? 'var(--danger)' : undefined }}
            >
              {(stats.errored ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="user-detail-stat">
            <span className="user-detail-stat-label">Data</span>
            <span className="user-detail-stat-value">
              {formatBytes(succeeded?.totalBytes ?? 0)}
            </span>
          </div>
          <div className="user-detail-stat">
            <span className="user-detail-stat-label">Avg Speed</span>
            <span className="user-detail-stat-value">
              {formatSpeed(succeeded?.averageSpeed ?? 0)}
            </span>
          </div>
          <div className="user-detail-stat">
            <span className="user-detail-stat-label">Cancelled</span>
            <span className="user-detail-stat-value">
              {(stats.cancelled ?? 0).toLocaleString()}
            </span>
          </div>
        </div>
        {data.exceptions && data.exceptions.length > 0 && (
          <div className="user-report-exceptions">
            <div className="user-report-exceptions-title">Top Errors</div>
            {data.exceptions.slice(0, 5).map((ex, index) => (
              <div
                className="error-item"
                // eslint-disable-next-line react/no-array-index-key
                key={index}
              >
                <span className="error-msg">
                  {ex.exception ?? ex.Exception ?? 'Unknown'}
                </span>
                <span className="error-count">
                  {(ex.count ?? ex.Count ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="user-report-overview-tab">
      {renderDir('Upload', detail.Upload ?? detail.upload)}
      {renderDir('Download', detail.Download ?? detail.download)}
    </div>
  );
};

const TransfersTab = ({ username }) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    reportsAPI
      .getUserTransfers({
        username,
        direction: direction || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(({ items: rows, total: t }) => {
        setItems(rows);
        setTotal(t);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [direction, page, username]);

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="user-report-transfers-tab">
      <div className="user-report-tab-controls">
        <select
          className="user-report-select"
          onChange={(e) => {
            setDirection(e.target.value);
            setPage(0);
          }}
          value={direction}
        >
          <option value="">All directions</option>
          <option value="upload">Uploads</option>
          <option value="download">Downloads</option>
        </select>
        <span className="user-report-count">
          {total.toLocaleString()} records
        </span>
      </div>
      {loading ? (
        <div className="user-report-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="user-report-empty">No transfers</div>
      ) : (
        <>
          <table className="user-report-table">
            <thead>
              <tr>
                <th>File</th>
                <th className="user-report-num">Size</th>
                <th>State</th>
                <th className="user-report-num">Speed</th>
                <th className="user-report-num">Date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id ?? t.Id}>
                  <td>
                    <div
                      className="user-report-filename"
                      title={t.filename ?? t.Filename}
                    >
                      <span
                        className={`user-report-dir-badge user-report-dir-badge--${(t.direction ?? t.Direction ?? '').toLowerCase()}`}
                      >
                        {(t.direction ?? t.Direction ?? '?')[0].toUpperCase()}
                      </span>
                      <div className="user-report-filename-cell">
                        <span className="user-report-filename-text">
                          {getFileName(t.filename ?? t.Filename ?? '')}
                        </span>
                        <span className="user-report-folder-text">
                          {leafFolder(t.filename ?? t.Filename ?? '')}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="user-report-num">
                    {formatBytes(t.size ?? t.Size ?? 0)}
                  </td>
                  <td>
                    <span
                      className="user-report-state"
                      style={{
                        color: stateColor(
                          t.stateDescription ?? t.StateDescription,
                        ),
                      }}
                      title={t.exception ?? t.Exception}
                    >
                      {(
                        t.stateDescription ??
                        t.StateDescription ??
                        'Unknown'
                      ).replace('Completed, ', '')}
                    </span>
                  </td>
                  <td className="user-report-num">
                    {(t.stateDescription ?? t.StateDescription ?? '').includes(
                      'Succeeded',
                    )
                      ? formatSpeed(t.averageSpeed ?? t.AverageSpeed ?? 0)
                      : '—'}
                  </td>
                  <td className="user-report-num user-report-date">
                    {t.endedAt ?? t.EndedAt
                      ? formatDate(t.endedAt ?? t.EndedAt)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 && (
            <div className="user-report-pagination">
              <button
                className="user-report-page-btn"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                type="button"
              >
                ‹
              </button>
              <span className="user-report-page-info">
                {page + 1} / {pageCount}
              </span>
              <button
                className="user-report-page-btn"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
                type="button"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const BrowseTab = ({ username }) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    reportsAPI
      .getUserBrowseEvents({
        username,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(({ items: rows, total: t }) => {
        setItems(rows);
        setTotal(t);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page, username]);

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="user-report-browse-tab">
      <div className="user-report-tab-controls">
        <span className="user-report-count">
          {total.toLocaleString()} browse events
        </span>
      </div>
      {loading ? (
        <div className="user-report-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="user-report-empty">No browse history</div>
      ) : (
        <>
          <div className="user-report-browse-list">
            {items.map((ts) => (
              <div
                className="user-report-browse-item"
                key={ts}
              >
                {formatDate(ts)}
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div className="user-report-pagination">
              <button
                className="user-report-page-btn"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                type="button"
              >
                ‹
              </button>
              <span className="user-report-page-info">
                {page + 1} / {pageCount}
              </span>
              <button
                className="user-report-page-btn"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
                type="button"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const UserReportModal = ({ initialTab, onClose, seed, username }) => {
  const history = useHistory();
  const [activeTab, setActiveTab] = useState(initialTab || 'overview');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [networkInfo, setNetworkInfo] = useState(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkOffline, setNetworkOffline] = useState(false);

  // Reset to the requested tab whenever the modal opens for a (new) user.
  useEffect(() => {
    setActiveTab(initialTab || 'overview');
  }, [initialTab, username]);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setDetailLoading(true);
    reportsAPI
      .getUserDetail({ username })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setNetworkOffline(false);

    // The map dot already resolved geo for this peer — seed the bar to skip a
    // redundant lookup. Fall back to the live lookup when no seed is provided.
    if (seed?.ip) {
      setNetworkInfo({
        ipAddress: seed.ip,
        city: seed.city,
        country: seed.country,
        isVpn: seed.isVpn,
      });
      setNetworkLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setNetworkInfo(null);
    setNetworkLoading(true);
    reportsAPI
      .getUserNetworkInfo({ username })
      .then((info) => {
        if (!cancelled) {
          if (info) setNetworkInfo(info);
          else setNetworkOffline(true);
        }
      })
      .finally(() => {
        if (!cancelled) setNetworkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seed, username]);

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'transfers', label: 'Transfers' },
    { id: 'browse', label: 'Browse History' },
  ];

  const openBrowse = () => {
    onClose();
    history.push('/browse', { user: username });
  };

  return (
    <Modal
      className="user-report-modal"
      closeIcon
      onClose={onClose}
      open={Boolean(username)}
      size="large"
    >
      <Header>
        <UsernameLink
          active="report"
          username={username}
        />
      </Header>
      <Modal.Content>
        <div className="user-report-network-bar">
          {networkLoading ? (
            <span className="user-report-network-label">Looking up IP…</span>
          ) : networkOffline ? (
            <span className="user-report-network-label">IP unavailable</span>
          ) : networkInfo ? (
            <>
              <span className="user-report-network-item">
                <span className="user-report-network-label">IP</span>
                <span>{networkInfo.ipAddress}</span>
              </span>
              {networkInfo.country && (
                <span className="user-report-network-item">
                  <span className="user-report-network-label">Country</span>
                  <span>{networkInfo.country}</span>
                </span>
              )}
              {networkInfo.city && (
                <span className="user-report-network-item">
                  <span className="user-report-network-label">City</span>
                  <span>{networkInfo.city}</span>
                </span>
              )}
            </>
          ) : null}
        </div>
        <div className="user-report-modal-tabs">
          {TABS.map((tab) => (
            <button
              className={`user-report-modal-tab${activeTab === tab.id ? ' active' : ''}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
          <button
            className="user-report-modal-tab user-report-modal-tab--link"
            onClick={openBrowse}
            title="Open this user's shared files in Browse"
            type="button"
          >
            Files
            <ExternalLink size={11} />
          </button>
        </div>
        <div className="user-report-modal-body">
          {activeTab === 'overview' && (
            <OverviewTab
              detail={detail}
              loading={detailLoading}
            />
          )}
          {activeTab === 'transfers' && <TransfersTab username={username} />}
          {activeTab === 'browse' && <BrowseTab username={username} />}
        </div>
      </Modal.Content>
    </Modal>
  );
};

export default UserReportModal;
