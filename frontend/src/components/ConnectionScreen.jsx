// <copyright file="ConnectionScreen.jsx" company="John Narey">
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

import ResonanceMark from './Shared/ResonanceMark';
import React, { useEffect, useState } from 'react';
import { Button } from 'semantic-ui-react';

const formatElapsed = (since, now) => {
  const total = Math.max(0, Math.floor((now - since.getTime()) / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const mmss = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : mmss;
};

// Single connection-status UI. variant='initial' fills the screen (startup,
// nothing behind it); variant='overlay' dims the running app and floats a
// panel so the user keeps their context while we reconnect.
const ConnectionScreen = ({
  attempt = 0,
  message,
  onRetryNow,
  since,
  variant = 'initial',
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!since) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [since]);

  const detailParts = [];
  if (attempt > 1) detailParts.push(`attempt ${attempt}`);
  if (since) detailParts.push(formatElapsed(since, now));

  const panel = (
    <div
      className={
        variant === 'overlay'
          ? 'app-connecting app-connecting--panel'
          : 'app-connecting dj-workspace'
      }
    >
      <div className="app-connecting-icon">
        <ResonanceMark size={36} />
      </div>
      <div className="app-connecting-name">Resonance</div>
      <div className="app-connecting-status">
        {message}
        <span className="app-connecting-dots">
          <span />
          <span />
          <span />
        </span>
      </div>
      {detailParts.length > 0 && (
        <div className="app-connecting-attempt">{detailParts.join(' · ')}</div>
      )}
      {onRetryNow && (
        <Button
          className="app-connection-retry hover-fx"
          onClick={onRetryNow}
          size="small"
        >
          Retry now
        </Button>
      )}
    </div>
  );

  if (variant === 'overlay') {
    return <div className="app-connection-overlay dj-workspace">{panel}</div>;
  }

  return panel;
};

export default ConnectionScreen;
