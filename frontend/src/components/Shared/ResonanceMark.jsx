// <copyright file="ResonanceMark.jsx" company="John Narey">
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

import './ResonanceMark.css';
import React from 'react';

const ResonanceMark = ({ size = 24 }) => (
  <svg
    aria-hidden="true"
    className="resonance-mark"
    fill="none"
    focusable="false"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      className="resonance-mark-ring"
      cx="12"
      cy="12"
      r="8"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path
      className="resonance-mark-wave"
      d="M4 12 C6 6.5 10 6.5 12 12 C14 17.5 18 17.5 20 12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.7"
    />
    <path
      className="resonance-mark-highlight"
      d="M6.4 6.4 A8 8 0 0 1 12 4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.7"
    />
    <circle
      className="resonance-mark-core"
      cx="12"
      cy="12"
      fill="currentColor"
      r="1.3"
    />
  </svg>
);

export default ResonanceMark;
