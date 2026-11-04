// <copyright file="RecentUploadHistory.jsx" company="John Narey">
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
import { getTransferHistory } from '../../lib/reports';
import { formatBytes, getFileName } from '../../lib/util';
import { historyOutcome } from '../Transfers/transferHistoryState';
import { ArrowRight, History } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const PREVIEW_LIMIT = 8;

const RecentUploadHistory = ({ range, refreshKey }) => {
  const [result, setResult] = useState({ items: [], loading: true });

  useEffect(() => {
    const controller = new AbortController();
    // Retain rows during a scheduled refresh, but never show the previous range.
    setResult((current) =>
      current.range === range
        ? { ...current, loading: true, error: false }
        : { range, items: [], loading: true },
    );
    const end = new Date();
    getTransferHistory({
      direction: 'Upload',
      start: new Date(end.getTime() - range * 3_600_000).toISOString(),
      end: end.toISOString(),
      limit: PREVIEW_LIMIT,
      signal: controller.signal,
    })
      .then(({ items }) => {
        if (!controller.signal.aborted)
          setResult({
            range,
            items: (items ?? []).slice(0, PREVIEW_LIMIT),
            loading: false,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult((current) => ({ ...current, loading: false, error: true }));
      });
    return () => controller.abort();
  }, [range, refreshKey]);

  return (
    <section
      aria-labelledby="recent-upload-title"
      className="recent-uploads"
    >
      <header className="recent-uploads-header">
        <div>
          <h2 id="recent-upload-title">
            <History size={16} />
            Recent uploads
          </h2>
          <p>Latest finished transfers in this period</p>
        </div>
        <Link to={`${urlBase}/history`}>
          View full history <ArrowRight size={14} />
        </Link>
      </header>
      {result.error && (
        <p
          className="recent-uploads-message"
          role="alert"
        >
          Unable to refresh upload history.{' '}
          {result.items.length > 0
            ? 'Showing the last loaded transfers.'
            : 'Try the full history page or refresh this view.'}
        </p>
      )}
      <div aria-busy={result.loading}>
        {result.items.length > 0 ? (
          <ol className="recent-uploads-list">
            {result.items.map((item) => {
              const outcome = historyOutcome(item.stateDescription);
              const date = new Date(item.endedAt);
              const validDate = item.endedAt && !Number.isNaN(date.getTime());
              return (
                <li key={item.id}>
                  <div className="recent-upload-file">
                    <strong title={item.filename}>
                      {getFileName(item.filename ?? '') || 'Unknown file'}
                    </strong>
                    <span title={item.username}>
                      To {item.username || 'Unknown peer'} ·{' '}
                      {formatBytes(item.size)}
                    </span>
                  </div>
                  <div className="recent-upload-result">
                    <span
                      className={`recent-upload-outcome ${outcome.className}`}
                    >
                      {outcome.label}
                    </span>
                    {validDate ? (
                      <time
                        dateTime={item.endedAt}
                        title={date.toLocaleString()}
                      >
                        {date.toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    ) : (
                      <span>Time unknown</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          !result.error && (
            <p
              className="recent-uploads-message"
              role="status"
            >
              {result.loading
                ? 'Loading recent uploads…'
                : 'No finished uploads in this period.'}
            </p>
          )
        )}
      </div>
    </section>
  );
};

export default RecentUploadHistory;
