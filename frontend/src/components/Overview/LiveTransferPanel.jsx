// <copyright file="LiveTransferPanel.jsx" company="John Narey">
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
import { formatBytes, getFileName } from '../../lib/util';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

const LiveTransferPanel = ({ direction, transfers }) => {
  const isDownload = direction === 'download';
  const Icon = isDownload ? ArrowDown : ArrowUp;
  const label = isDownload ? 'Downloads' : 'Uploads';
  const path = `${urlBase}/${direction}s`;

  const list = Array.isArray(transfers) ? transfers : [];
  const active = list.filter((t) => t.state === 'InProgress');
  const queued = list.filter(
    (t) => t.state?.startsWith('Queued') || t.state === 'Requested',
  );
  const totalSpeed = active.reduce((s, t) => s + (t.averageSpeed ?? 0), 0);

  return (
    <div className="live-panel">
      <div className="live-panel-header">
        <div className="live-panel-title">
          <Icon
            size={14}
            strokeWidth={1.75}
          />
          <span>{label}</span>
        </div>
        <div className="live-panel-stats">
          <span className="live-speed">{formatBytes(totalSpeed)}/s</span>
          {active.length > 0 && (
            <span className="live-total">{active.length} active</span>
          )}
        </div>
        <Link
          className="live-panel-link"
          to={path}
        >
          View all
          <ArrowRight
            size={11}
            strokeWidth={1.75}
          />
        </Link>
      </div>

      <div className="live-panel-body">
        {active.length === 0 && queued.length === 0 ? (
          <div className="live-idle">Idle</div>
        ) : (
          <>
            {active.slice(0, 4).map((t) => (
              <div
                className="live-transfer-row"
                key={t.id}
              >
                <div
                  className="live-transfer-name"
                  title={t.filename}
                >
                  {getFileName(t.filename ?? '')}
                </div>
                <div className="live-transfer-progress">
                  <div className="live-progress-bar">
                    <div
                      className="live-progress-fill"
                      style={{ width: `${t.percentComplete ?? 0}%` }}
                    />
                  </div>
                  <span className="live-pct">
                    {Math.round(t.percentComplete ?? 0)}%
                  </span>
                </div>
              </div>
            ))}
            {active.length > 4 && (
              <div className="live-more">+{active.length - 4} more active</div>
            )}
            {queued.length > 0 && (
              <div className="live-queued">{queued.length} queued</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LiveTransferPanel;
