// <copyright file="SocialPulse.jsx" company="John Narey">
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

import { AtSign, Eye, MessageSquare, Users } from 'lucide-react';
import React from 'react';

// Discovery & social signals — browsing without downloading is a distinct interest signal.
const SocialPulse = ({ data }) => {
  const tiles = [
    { Icon: Eye, key: 'browsed', label: 'Browses', value: data?.browsed },
    {
      Icon: MessageSquare,
      key: 'pm',
      label: 'Private msgs',
      value: data?.privateMessages,
    },
    {
      Icon: Users,
      key: 'room',
      label: 'Room msgs',
      value: data?.roomMessages,
    },
    { Icon: AtSign, key: 'mention', label: 'Mentions', value: data?.mentions },
  ];

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Social Pulse</span>
      </div>
      <div className="social-grid">
        {tiles.map(({ Icon, key, label, value }) => (
          <div
            className="social-tile"
            key={key}
          >
            <Icon
              className="social-icon"
              size={16}
              strokeWidth={1.75}
            />
            <span className="social-value">
              {Number(value ?? 0).toLocaleString()}
            </span>
            <span className="social-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SocialPulse;
