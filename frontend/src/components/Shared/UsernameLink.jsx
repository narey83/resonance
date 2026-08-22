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

import {
  blockUser,
  isBlocked,
  unblockUser,
  useBlockedUsers,
} from '../../lib/blockedUsers';
import { isAdmin } from '../../lib/token';
import UserReportWindow from '../Overview/UserReportWindow';
import { Ban, BarChart3, FolderSearch, MessageSquare } from 'lucide-react';
import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';

// `active` names the view the user is already in — 'report', 'chat' or
// 'browse'. That action's button is greyed out and disabled (rather than
// removed) so the icon row stays visually stable; e.g. the report modal and
// the chat pane each render a UsernameLink in their own header.
// `onReport` lets a caller host the report modal itself instead of letting this
// component render it. Needed where the link lives in a transient container (the
// map tooltip): the caller can dismiss that container and still keep the modal
// mounted, which wouldn't survive if the modal hung off this subtree.
const UsernameLink = ({
  active,
  className,
  onReport,
  self,
  style,
  username,
}) => {
  const history = useHistory();
  const [showReport, setShowReport] = useState(false);

  // The report pulls admin-only analytics endpoints, so the button only makes
  // sense — and only works — for administrators. It also only makes sense for
  // someone else: it shows what THIS SERVER has observed a peer doing, keyed
  // purely by their claimed username — Soulseek doesn't authenticate that
  // string beyond the name itself, so a same-named peer's activity can end up
  // filed under it too. There's nothing here to show reliably about yourself.
  const canReport = isAdmin() && !self;

  // Subscribe so the icon flips live when this user is (un)blocked anywhere,
  // including from another client.
  useBlockedUsers();
  const blocked = isBlocked(username);

  const go = (e, path) => {
    e.stopPropagation();
    history.push(path, { user: username });
  };

  const openReport = (e) => {
    e.stopPropagation();
    if (onReport) {
      onReport(username);
      return;
    }

    setShowReport(true);
  };

  const toggleBlocked = (e) => {
    e.stopPropagation();
    if (blocked) {
      unblockUser(username);
    } else {
      blockUser(username);
    }
  };

  return (
    <span
      className={`ulink-root${blocked ? ' ulink-root-blocked' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <span
        className="ulink-name"
        title={blocked ? `${username} (blocked)` : username}
      >
        {username}
      </span>
      <span
        aria-hidden="true"
        className="ulink-sep"
      />
      {canReport && (
        <button
          className="ulink-icon-btn hover-fx"
          disabled={active === 'report'}
          onClick={openReport}
          title={active === 'report' ? 'Viewing report' : 'User report'}
          type="button"
        >
          <BarChart3
            size={12}
            strokeWidth={1.75}
          />
        </button>
      )}
      <button
        className="ulink-icon-btn hover-fx"
        disabled={active === 'chat'}
        onClick={(e) => go(e, '/chat')}
        title={active === 'chat' ? 'In this chat' : 'Chat'}
        type="button"
      >
        <MessageSquare
          size={12}
          strokeWidth={1.75}
        />
      </button>
      <button
        className="ulink-icon-btn hover-fx"
        disabled={active === 'browse'}
        onClick={(e) => go(e, '/browse')}
        title={active === 'browse' ? 'Browsing this user' : 'Browse files'}
        type="button"
      >
        <FolderSearch
          size={12}
          strokeWidth={1.75}
        />
      </button>
      <button
        className={`ulink-icon-btn hover-fx${blocked ? ' ulink-blocked' : ''}`}
        onClick={toggleBlocked}
        title={blocked ? 'Unblock user' : 'Block user'}
        type="button"
      >
        <Ban
          size={12}
          strokeWidth={1.75}
        />
      </button>
      {showReport && (
        <UserReportWindow
          onClose={() => setShowReport(false)}
          username={username}
        />
      )}
    </span>
  );
};

export default UsernameLink;
