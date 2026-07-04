// <copyright file="UsernameLink.jsx" company="John Narey">
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

import { FolderSearch, MessageSquare } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useHistory } from 'react-router-dom';

const UsernameLink = ({ className, style, username }) => {
  const [menuPos, setMenuPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const history = useHistory();

  const open = menuPos !== null;

  const openMenu = (e) => {
    e.stopPropagation();
    if (open) {
      setMenuPos(null);
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ left: rect.left, top: rect.bottom + 4 });
  };

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setMenuPos(null);
      }
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const go = (path) => {
    setMenuPos(null);
    history.push(path, { user: username });
  };

  return (
    <span
      className={`ulink-root${className ? ` ${className}` : ''}`}
      style={style}
    >
      <button
        className="ulink-trigger"
        onClick={openMenu}
        ref={triggerRef}
        title={username}
        type="button"
      >
        {username}
      </button>
      {open &&
        ReactDOM.createPortal(
          <div
            className="ulink-menu"
            ref={menuRef}
            style={{ left: menuPos.left, position: 'fixed', top: menuPos.top }}
          >
            <button
              className="ulink-item"
              onClick={() => go('/chat')}
              type="button"
            >
              <MessageSquare
                size={13}
                strokeWidth={1.75}
              />
              Chat
            </button>
            <button
              className="ulink-item"
              onClick={() => go('/browse')}
              type="button"
            >
              <FolderSearch
                size={13}
                strokeWidth={1.75}
              />
              Browse files
            </button>
          </div>,
          document.body,
        )}
    </span>
  );
};

export default UsernameLink;
