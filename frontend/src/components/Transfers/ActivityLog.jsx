// <copyright file="ActivityLog.jsx" company="John Narey">
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

import { formatBitrate, formatBytes, getFileName } from '../../lib/util';
import { UsernameLink } from '../Shared';
import { ArrowDown, ArrowUp } from 'lucide-react';
import React, { useMemo } from 'react';

const ActivityLog = ({ direction, transfers }) => {
  const activeFiles = useMemo(() => {
    return (transfers ?? [])
      .flatMap((user) =>
        (user.directories ?? []).flatMap((directory) =>
          (directory.files ?? [])
            .filter(
              (file) =>
                file.direction?.toLowerCase() === direction &&
                file.state === 'InProgress',
            )
            .map((file) => ({ ...file, username: user.username })),
        ),
      )
      .sort((a, b) => (b.averageSpeed ?? 0) - (a.averageSpeed ?? 0));
  }, [direction, transfers]);

  if (activeFiles.length === 0) return null;

  const Icon = direction === 'upload' ? ArrowUp : ArrowDown;

  return (
    <div className="activity-log">
      <div className="activity-log-header">
        <span className="activity-log-pulse" />
        {activeFiles.length} active {direction}
        {activeFiles.length === 1 ? '' : 's'}
      </div>
      <div className="activity-log-rows">
        {activeFiles.slice(0, 10).map((file) => (
          <div
            className="activity-log-row"
            key={file.id}
          >
            <Icon
              className="activity-log-icon"
              size={11}
              strokeWidth={2.5}
            />
            <UsernameLink
              className="activity-log-user"
              username={file.username}
            />
            <span
              className="activity-log-filename"
              title={getFileName(file.filename)}
            >
              {getFileName(file.filename)}
            </span>
            <div className="activity-log-bar">
              <div
                className="activity-log-bar-fill"
                style={{ width: `${Math.round(file.percentComplete ?? 0)}%` }}
              />
            </div>
            <span className="activity-log-pct">
              {Math.round(file.percentComplete ?? 0)}%
            </span>
            <span className="activity-log-size">
              {formatBytes(file.bytesTransferred ?? 0)} /{' '}
              {formatBytes(file.size ?? 0)}
            </span>
            <span className="activity-log-speed">
              {file.averageSpeed > 0 ? formatBitrate(file.averageSpeed) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActivityLog;
