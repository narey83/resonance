// <copyright file="token.js" company="JP Dillingham">
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

import {
  refreshTokenKey,
  sessionIdKey,
  tokenKey,
  tokenPassthroughValue,
} from '../config';

export const getToken = () =>
  sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey);
export const setToken = (storage, token) => storage.setItem(tokenKey, token);
export const clearToken = () => {
  localStorage.removeItem(tokenKey);
  sessionStorage.removeItem(tokenKey);
};

export const getRefreshToken = () =>
  sessionStorage.getItem(refreshTokenKey) ||
  localStorage.getItem(refreshTokenKey);
export const setRefreshToken = (storage, token) =>
  storage.setItem(refreshTokenKey, token);
export const clearRefreshToken = () => {
  localStorage.removeItem(refreshTokenKey);
  sessionStorage.removeItem(refreshTokenKey);
};

export const clearMatchingRefreshToken = (token) => {
  if (!token) return;
  for (const storage of [sessionStorage, localStorage]) {
    if (storage.getItem(refreshTokenKey) !== token) continue;
    storage.removeItem(tokenKey);
    storage.removeItem(refreshTokenKey);
    storage.removeItem(sessionIdKey);
  }
};

export const getRefreshTokenStorage = () =>
  sessionStorage.getItem(refreshTokenKey) !== null
    ? sessionStorage
    : localStorage;

export const getSessionId = () =>
  sessionStorage.getItem(sessionIdKey) || localStorage.getItem(sessionIdKey);
export const setSessionId = (storage, id) => storage.setItem(sessionIdKey, id);
export const clearSessionId = () => {
  localStorage.removeItem(sessionIdKey);
  sessionStorage.removeItem(sessionIdKey);
};

export const isPassthroughEnabled = () => getToken() === tokenPassthroughValue;

const decodeJwtPayload = () => {
  try {
    const token = getToken();
    if (!token || token === tokenPassthroughValue) return null;
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
};

export const getRole = () => {
  const p = decodeJwtPayload();
  // ASP.NET Core uses the long claim URI for role
  return (
    p?.['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ??
    p?.role ??
    null
  );
};

export const getUsername = () => {
  const p = decodeJwtPayload();
  return (
    p?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ??
    p?.name ??
    null
  );
};

export const isAdmin = () => getRole() === 'Administrator';

// Returns the JWT's `exp` claim as a JS epoch (ms), or null.
export const getTokenExpiry = () => {
  const p = decodeJwtPayload();
  return typeof p?.exp === 'number' ? p.exp * 1_000 : null;
};
