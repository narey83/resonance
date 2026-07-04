// <copyright file="config.js" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

const urlBase = (window.urlBase === '/' ? '' : window.urlBase) || '';
const rootUrl = urlBase;
// eslint-disable-next-line n/no-process-env
const apiBaseUrl = process.env.REACT_APP_API_URL || `${rootUrl}/api/v0`;
// eslint-disable-next-line n/no-process-env
const hubBaseUrl = process.env.REACT_APP_HUB_URL || `${rootUrl}/hub`;
// eslint-disable-next-line n/no-process-env
const castAppId = process.env.REACT_APP_CAST_APP_ID || null;
const tokenKey = 'resonance-token';
const refreshTokenKey = 'resonance-refresh-token';
const sessionIdKey = 'resonance-session-id';
const tokenPassthroughValue = 'n/a';
const activeChatKey = 'resonance-active-chat';
const activeRoomKey = 'resonance-active-room';
const activeUserInfoKey = 'resonance-active-user';

export {
  activeChatKey,
  activeRoomKey,
  activeUserInfoKey,
  apiBaseUrl,
  castAppId,
  hubBaseUrl,
  refreshTokenKey,
  rootUrl,
  sessionIdKey,
  tokenKey,
  tokenPassthroughValue,
  urlBase,
};
