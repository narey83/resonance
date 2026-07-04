// <copyright file="api.js" company="JP Dillingham">
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

import { apiBaseUrl } from '../config';
import {
  clearRefreshToken,
  clearSessionId,
  clearToken,
  getRefreshToken,
  getRefreshTokenStorage,
  getToken,
  isPassthroughEnabled,
  setRefreshToken,
  setSessionId,
  setToken,
} from './token';
import axios from 'axios';

axios.defaults.baseURL = apiBaseUrl;

const api = axios.create({
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getToken();

  if (!(config.data instanceof FormData))
    config.headers['Content-Type'] = 'application/json';

  if (!isPassthroughEnabled() && token) {
    config.headers.Authorization = 'Bearer ' + token;
  }

  return config;
});

let refreshPromise = null;

export const attemptRefresh = () => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const refreshToken = getRefreshToken();
        const storage = getRefreshTokenStorage();
        const { data } = await axios.post('session/refresh', { refreshToken });
        setToken(storage, data.token);
        if (data.refreshToken) setRefreshToken(storage, data.refreshToken);
        if (data.sessionId) setSessionId(storage, data.sessionId);
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const status = error.response?.status;

    if (
      status === 401 &&
      !config._isRefreshRetry &&
      !config.url?.includes('session/refresh')
    ) {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          await attemptRefresh();
          config._isRefreshRetry = true;
          config.headers.Authorization = 'Bearer ' + getToken();
          return api(config);
        } catch (refreshError) {
          if (refreshError.response?.status === 401) {
            clearToken();
            clearRefreshToken();
            clearSessionId();
            window.location.reload(true);
          }

          throw error;
        }
      }
    }

    if (
      status === 401 &&
      !['/session', '/server', '/application'].includes(config?.url) &&
      getToken()
    ) {
      console.debug('received 401 from api route, logging out');
      clearToken();
      window.location.reload(true);
    }

    throw error;
  },
);

export default api;
