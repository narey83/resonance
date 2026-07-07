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
import React from 'react';
import { useHistory } from 'react-router-dom';

const UsernameLink = ({ className, style, username }) => {
  const history = useHistory();

  const go = (e, path) => {
    e.stopPropagation();
    history.push(path, { user: username });
  };

  return (
    <span
      className={`ulink-root${className ? ` ${className}` : ''}`}
      style={style}
    >
      <span
        className="ulink-name"
        title={username}
      >
        {username}
      </span>
      <button
        className="ulink-icon-btn hover-fx"
        onClick={(e) => go(e, '/chat')}
        title="Chat"
        type="button"
      >
        <MessageSquare
          size={12}
          strokeWidth={1.75}
        />
      </button>
      <button
        className="ulink-icon-btn hover-fx"
        onClick={(e) => go(e, '/browse')}
        title="Browse files"
        type="button"
      >
        <FolderSearch
          size={12}
          strokeWidth={1.75}
        />
      </button>
    </span>
  );
};

export default UsernameLink;
