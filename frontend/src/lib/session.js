// <copyright file="session.js" company="JP Dillingham">
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

import { tokenPassthroughValue } from '../config';
import api from './api';
import {
  clearRefreshToken,
  clearSessionId,
  clearToken,
  getRefreshToken,
  getSessionId,
  getToken,
  setRefreshToken,
  setSessionId,
  setToken,
} from './token';

export const getInitialized = async () => {
  return (await api.get('/session/initialized')).data;
};

const getDeviceName = () => {
  const ua = navigator.userAgent;
  let os;
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Macintosh/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  else os = 'Browser';

  // Include the browser so the session manager can tell apart two logins from the same machine.
  // Storage is origin-scoped, so each browser (and each origin) already gets its own browserId below;
  // labelling the browser makes those distinct entries self-explanatory instead of looking duplicated.
  // Order matters: Edge/Opera UAs also contain "Chrome", and Chrome's UA contains "Safari".
  let browser;
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else browser = null;

  const key = 'resonance_browser_id';
  let browserId = localStorage.getItem(key);
  if (!browserId) {
    browserId = crypto.randomUUID();
    localStorage.setItem(key, browserId);
  }

  const platform = browser ? `${os} · ${browser}` : os;
  return `${platform} (${browserId.slice(0, 8)})`;
};

export const setup = async ({ username, password }) => {
  const { token, refreshToken, sessionId } = (
    await api.post('/session/setup', {
      password,
      username,
      deviceName: getDeviceName(),
      existingSessionId: getSessionId(),
    })
  ).data;
  setToken(localStorage, token);
  if (refreshToken) setRefreshToken(localStorage, refreshToken);
  if (sessionId) setSessionId(localStorage, sessionId);
  return token;
};

export const enablePassthrough = () => {
  console.debug(
    'enabling token passthrough.  api calls will not be authenticated',
  );
  setToken(sessionStorage, tokenPassthroughValue);
};

export const isLoggedIn = () => {
  const token = getToken();
  return (
    token !== undefined && token !== null && token !== tokenPassthroughValue
  );
};

export const login = async ({ username, password, rememberMe = false }) => {
  const storage = rememberMe ? localStorage : sessionStorage;
  const { token, refreshToken, sessionId } = (
    await api.post('/session', {
      password,
      username,
      deviceName: getDeviceName(),
      existingSessionId: getSessionId(),
    })
  ).data;
  setToken(storage, token);
  if (refreshToken) setRefreshToken(storage, refreshToken);
  if (sessionId) setSessionId(storage, sessionId);
  return token;
};

export const logout = async () => {
  const refreshToken = getRefreshToken();
  clearToken();
  clearRefreshToken();
  clearSessionId();
  if (refreshToken) {
    try {
      await api.delete('/session', { data: { refreshToken } });
    } catch {
      // best-effort — token is already cleared locally
    }
  }
};

/**
 * Requests a single-use pairing code for the CURRENT app account. The code carries no credentials —
 * it is bound to this user, expires, and dies on first use — so a photograph of the QR is worth
 * little and can be retired by generating another.
 */
export const createPairingCode = async () => {
  return (await api.post('/session/pair')).data;
};

/**
 * Polls what became of a pairing code. Returns null once the server has forgotten it (expired),
 * which the caller treats the same as "gone".
 */
export const getPairingStatus = async (code) => {
  try {
    return (await api.get('/session/pair/status', { params: { code } })).data;
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
};

export const getSessions = async () => {
  return (await api.get('/session/sessions')).data;
};

export const revokeSession = async (id) => {
  return api.delete(`/session/sessions/${id}`);
};

export const revokeAllSessions = async () => {
  return api.delete('/session/sessions');
};

export const getStatus = async () => {
  return (await api.get('/server/status')).data;
};

export const setStatus = async ({ presence, description }) => {
  return (await api.put('/server/status', { presence, description })).data;
};

export const check = async () => {
  try {
    await api.get('/session');
    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      clearToken();
      clearRefreshToken();
      clearSessionId();
      return false;
    } else {
      throw error;
    }
  }
};
