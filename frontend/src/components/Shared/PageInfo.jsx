// <copyright file="PageInfo.jsx" company="John Narey">
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

import './PageInfo.css';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import React, { useState } from 'react';

/**
 * Collapsible help panel that remembers its state in localStorage.
 * Defaults to open on first visit; closing persists across sessions.
 *
 * Usage:
 *   <PageInfo storageKey="keyanalysis">
 *     <p>Explanation text here…</p>
 *   </PageInfo>
 */
const PageInfo = ({ children, storageKey }) => {
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(`page-info:${storageKey}`);
    return saved === null ? false : saved === '1';
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`page-info:${storageKey}`, next ? '1' : '0');
  };

  return (
    <div className="pi-root">
      <button
        className="pi-toggle"
        onClick={toggle}
        title={open ? 'Hide help' : 'Show help'}
        type="button"
      >
        <HelpCircle size={12} />
        <span className="pi-toggle-label">
          {open ? 'Hide help' : 'About this page'}
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && <div className="pi-body">{children}</div>}
    </div>
  );
};

export default PageInfo;
