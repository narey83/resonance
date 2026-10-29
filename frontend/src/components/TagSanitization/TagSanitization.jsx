// <copyright file="TagSanitization.jsx" company="John Narey">
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

import './TagSanitization.css';
import { runNow as runEnrichment } from '../../lib/metadataLookup';
import * as api from '../../lib/tagSanitization';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

const POLL_INTERVAL = 1_500;

const defaultState = {
  scanning: false,
  completed: false,
  cancelled: false,
  total: 0,
  processed: 0,
  sanitized: 0,
  skipped: 0,
  failed: 0,
  progress: 0,
  results: [],
};

const handleCancel = async () => {
  try {
    await api.cancelScan();
  } catch {
    // ignore — polling will pick up the cancelled state
  }
};

const TagSanitization = () => {
  const [scanState, setScanState] = useState(defaultState);
  const [workers, setWorkers] = useState(2);
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);
  // When set, the online metadata lookup is kicked off once the scan completes successfully.
  const enrichAfterRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const s = await api.getScanState();
      setScanState(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await fetchState();
      if (!s || s.scanning) return;

      stopPolling();

      // If this was a "Clean & enrich" run, start the online lookup now that the
      // sanitize finished — but only on a clean completion, not a cancel.
      if (enrichAfterRef.current) {
        enrichAfterRef.current = false;
        if (s.completed) {
          try {
            await runEnrichment();
            toast.success('Tags sanitized — online lookup started.');
          } catch {
            toast.error(
              'Sanitize finished, but the online lookup failed to start.',
            );
          }
        }
      }
    }, POLL_INTERVAL);
  };

  // Initial load
  useEffect(() => {
    void (async () => {
      const s = await fetchState();
      setLoading(false);
      if (s?.scanning) startPolling();
    })();

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginScan = async (enrich) => {
    enrichAfterRef.current = enrich;
    // "Clean & enrich" always writes; a dry run wouldn't change anything to enrich.
    if (enrich) setDryRun(false);

    try {
      await api.startScan({ workers, dryRun: enrich ? false : dryRun });
      setScanState((previous) => ({
        ...previous,
        scanning: true,
        completed: false,
        cancelled: false,
      }));
      startPolling();
    } catch (error) {
      enrichAfterRef.current = false;
      toast.error(error?.response?.data ?? 'Failed to start scan');
    }
  };

  const {
    cancelled,
    completed,
    failed,
    processed,
    progress,
    results,
    sanitized,
    scanning,
    skipped,
    total,
  } = scanState;
  const pct = total > 0 ? Math.round(progress * 100) : 0;

  const statusText = () => {
    if (loading) return null;
    if (scanning) return `Scanning… ${processed} / ${total}`;
    if (cancelled) return 'Scan cancelled';
    if (completed)
      return dryRun
        ? `Dry run complete — ${sanitized} file${sanitized === 1 ? '' : 's'} would be changed`
        : `Scan complete — ${sanitized} file${sanitized === 1 ? '' : 's'} sanitized`;
    return null;
  };

  return (
    <div className="ts-root">
      {/* Stats bar */}
      <div className="ts-stats-bar">
        <div className="ts-stat">
          <span className="ts-stat-value">{total}</span>
          <span className="ts-stat-label">Total</span>
        </div>
        <div className="ts-stat ts-stat--sanitized">
          <span className="ts-stat-value">{sanitized}</span>
          <span className="ts-stat-label">
            {dryRun ? 'Would change' : 'Sanitized'}
          </span>
        </div>
        <div className="ts-stat ts-stat--skipped">
          <span className="ts-stat-value">{skipped}</span>
          <span className="ts-stat-label">Clean</span>
        </div>
        {failed > 0 && (
          <div className="ts-stat ts-stat--failed">
            <span className="ts-stat-value">{failed}</span>
            <span className="ts-stat-label">Failed</span>
          </div>
        )}
        <div className="ts-spacer" />
        {statusText() && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {statusText()}
          </span>
        )}
      </div>

      {/* Settings */}
      <div className="ts-settings">
        <div className="ts-settings-group">
          <span className="ts-settings-label">Workers</span>
          <input
            disabled={scanning}
            max={8}
            min={1}
            onChange={({ target }) => setWorkers(Number(target.value))}
            type="range"
            value={workers}
          />
          <span className="ts-settings-val">{workers}</span>
        </div>

        <div className="ts-settings-group">
          <span className="ts-settings-label">Dry run</span>
          <label className="ts-toggle">
            <input
              checked={dryRun}
              disabled={scanning}
              onChange={({ target }) => setDryRun(target.checked)}
              type="checkbox"
            />
            <span className="ts-toggle-track" />
            <span className="ts-toggle-thumb" />
          </label>
        </div>

        {dryRun && (
          <span className="ts-dry-run-badge">
            analyse only — no files will be written
          </span>
        )}
      </div>

      {/* Progress bar (only when scanning) */}
      {scanning && (
        <div className="ts-progress">
          <div className="ts-progress-bar">
            <div
              className="ts-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="ts-progress-pct">{pct}%</span>
        </div>
      )}

      {/* Action bar */}
      <div className="ts-action-bar">
        {scanning ? (
          <button
            className="ts-btn ts-btn--cancel hover-fx"
            onClick={handleCancel}
            type="button"
          >
            Cancel Scan
          </button>
        ) : (
          <>
            <button
              className="ts-btn ts-btn--primary hover-fx"
              disabled={loading}
              onClick={() => beginScan(false)}
              type="button"
            >
              {dryRun ? 'Analyse Library' : 'Sanitize Tags'}
            </button>
            <button
              className="ts-btn ts-btn--secondary hover-fx"
              disabled={loading}
              onClick={() => beginScan(true)}
              title="Sanitize all tags, then run the online metadata lookup"
              type="button"
            >
              Clean &amp; enrich
            </button>
          </>
        )}
      </div>

      {/* Results list */}
      <div className="ts-results">
        {results.length === 0 ? (
          <div className="ts-empty">
            {completed || cancelled
              ? `${sanitized === 0 ? 'No files needed changes.' : ''}`
              : 'Run a scan to see results.'}
          </div>
        ) : (
          results.map((r) => (
            <div
              className="ts-result-row"
              key={r.maskedFilename}
            >
              <div className="ts-result-filename">
                {r.directory && (
                  <span className="ts-result-folder">{r.directory}</span>
                )}
                {r.filename}
              </div>
              <div className="ts-result-changes">
                {r.changes.map((c, index) => (
                  <span
                    className={`ts-change-chip${c.startsWith('Error:') ? ' ts-change-chip--error' : ''}`}
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TagSanitization;
