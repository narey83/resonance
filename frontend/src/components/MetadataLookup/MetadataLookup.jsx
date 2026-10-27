// <copyright file="MetadataLookup.jsx" company="John Narey">
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

import './MetadataLookup.css';
import { getStatus, runNow, stopNow } from '../../lib/metadataLookup';
import {
  AlertCircle,
  CheckCircle,
  Globe,
  Loader,
  MinusCircle,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

const STATUS_LABEL = {
  Failed: 'Failed',
  Looking: 'Looking…',
  NoMatch: 'No match',
  Queued: 'Queued',
  Written: 'Updated',
};

const formatEta = (seconds) => {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'Written':
      return <CheckCircle size={14} />;
    case 'Failed':
      return <AlertCircle size={14} />;
    case 'NoMatch':
      return <MinusCircle size={14} />;
    default:
      return (
        <Loader
          className="ml-spin"
          size={14}
        />
      );
  }
};

const MetadataLookup = () => {
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  const refresh = async () => {
    try {
      setStatus(await getStatus());
    } catch {
      /* transient — keep last known state */
    }
  };

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2_000);
    return () => clearInterval(pollRef.current);
  }, []);

  const handleRunNow = async (full = false) => {
    if (
      full &&
      !window.confirm(
        'Full re-scan queries the online services again for every track with missing details, ' +
          'including tracks they previously found no match for. This can take a long time. Continue?',
      )
    ) {
      return;
    }

    setStarting(true);
    try {
      await runNow(full);
      toast.info(
        full ? 'Full metadata re-scan started.' : 'Metadata lookup started.',
      );
      setTimeout(refresh, 750);
    } catch {
      toast.error('Could not start a lookup.');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopNow();
      toast.info('Stopping the metadata lookup pass…');
      setTimeout(refresh, 750);
    } catch {
      toast.error('Could not stop the lookup.');
    }
  };

  const progress = status ? Math.round((status.progress || 0) * 100) : 0;
  const done = status ? status.written + status.skipped + status.failed : 0;
  const eta = formatEta(status?.etaSeconds);
  const recent = status?.recent ?? [];

  return (
    <div className="ml-panel">
      <div className="ml-header">
        <div>
          <div className="ml-title">
            <Globe size={16} />
            Online metadata lookup
          </div>
          <div className="ml-subtitle">
            {status?.enabled
              ? 'Enabled — missing track details are filled in automatically from MusicBrainz.'
              : 'Disabled — turn it on in Settings → Options to fill in missing track details automatically.'}
          </div>
        </div>
        <div className="ml-actions">
          {status?.scanning && (
            <button
              className="ml-btn hover-fx"
              onClick={handleStop}
              title="Stop the current pass; it resumes where it left off next run"
              type="button"
            >
              <Square size={14} />
              Stop
            </button>
          )}
          <button
            className="ml-btn hover-fx"
            disabled={starting || status?.scanning}
            onClick={() => handleRunNow(true)}
            title="Re-query the online services for every track with missing details, including previous no-matches"
            type="button"
          >
            <RefreshCw size={14} />
            Full re-scan
          </button>
          <button
            className="ml-btn hover-fx"
            disabled={starting || status?.scanning}
            onClick={() => handleRunNow(false)}
            type="button"
          >
            {starting || status?.scanning ? (
              <Loader
                className="ml-spin"
                size={14}
              />
            ) : (
              <Play size={14} />
            )}
            {status?.paused
              ? 'Waiting for share indexing…'
              : status?.scanning
                ? 'Running…'
                : 'Run now'}
          </button>
        </div>
      </div>

      {status?.scanning && (
        <div className="ml-progress">
          {status.paused && (
            <p role="status">
              {status.pauseReason || 'Waiting for share indexing'} · resumes
              automatically.
            </p>
          )}
          <div className="ml-progress-bar">
            <div
              className="ml-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="ml-progress-stats">
            <span className="ml-count">
              {done} / {status.total}
            </span>
            <span className="ml-chip ml-chip--ok">
              {status.written} updated
            </span>
            <span className="ml-chip">{status.skipped} no match</span>
            {status.failed > 0 && (
              <span className="ml-chip ml-chip--err">
                {status.failed} failed
              </span>
            )}
            {eta && !status.paused && (
              <span className="ml-eta">~{eta} left</span>
            )}
          </div>
        </div>
      )}

      {!status?.scanning && status?.completed && status.total > 0 && (
        <div className="ml-idle">
          Last pass: {status.written} updated, {status.skipped} no match
          {status.failed > 0 ? `, ${status.failed} failed` : ''}.
        </div>
      )}

      <div className="ml-list">
        {recent.length === 0 ? (
          <div className="ml-empty">No recent activity.</div>
        ) : (
          recent.map((item) => (
            <div
              className="ml-item"
              key={item.maskedFilename}
            >
              <span
                className={`ml-item-status ml-item-status--${(item.status || '').toLowerCase()}`}
              >
                <StatusIcon status={item.status} />
                {STATUS_LABEL[item.status] ?? item.status}
              </span>
              <span className="ml-item-file">{item.filename}</span>
              {item.summary && (
                <span className="ml-item-summary">{item.summary}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MetadataLookup;
