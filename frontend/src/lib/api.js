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
import { siteAvailability } from './siteAvailability';
import {
  clearMatchingRefreshToken,
  clearRefreshToken,
  clearSessionId,
  clearToken,
  getRefreshToken,
  getRefreshTokenStorage,
  getSessionId,
  getToken,
  isPassthroughEnabled,
  setRefreshToken,
  setSessionId,
  setToken,
} from './token';
import axios, { create as createClient } from 'axios';

axios.defaults.baseURL = apiBaseUrl;

const api = createClient({
  withCredentials: true,
});

const isSessionAction = (config) =>
  config.method?.toLowerCase() !== 'get' &&
  /^\/?session(?:\/(?:setup|token|pair\/redeem))?$/.test(config.url || '');

api.interceptors.request.use((config) => {
  const token = getToken();
  if (config._sessionId === undefined)
    config._sessionId = getSessionId() ?? null;

  if (!(config.data instanceof FormData))
    config.headers['Content-Type'] = 'application/json';

  if (!isSessionAction(config) && !isPassthroughEnabled() && token) {
    config.headers.Authorization = 'Bearer ' + token;
  }

  return config;
});

let refreshPromise = null;

export const attemptRefresh = () => {
  if (!refreshPromise) {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.resolve();
    const storage = getRefreshTokenStorage();

    refreshPromise = (async () => {
      try {
        const { data } = await axios.post('session/refresh', { refreshToken });
        // A logout or a newer login may have replaced this session while the request
        // was in flight. Never restore its old credentials over the new session.
        if (getRefreshToken() !== refreshToken) return;
        setToken(storage, data.token);
        if (data.refreshToken) setRefreshToken(storage, data.refreshToken);
        if (data.sessionId) setSessionId(storage, data.sessionId);
      } catch (error) {
        // The server cannot repair an invalid refresh token. Remove only the
        // rejected session; another tab may have installed a newer one meanwhile.
        if (error.response?.status === 401)
          clearMatchingRefreshToken(refreshToken);
        throw error;
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
    siteAvailability.handleResponse(error.response);
    const config = error.config;
    const status = error.response?.status;
    if (!config) throw error;
    const sessionAction = isSessionAction(config);
    // A request from an earlier sign-in must never be replayed or clear the
    // credentials of the session that replaced it.
    if (status === 401 && config._sessionId !== (getSessionId() ?? null))
      throw error;

    if (
      status === 401 &&
      !config._isRefreshRetry &&
      !sessionAction &&
      !config.url?.includes('session/refresh')
    ) {
      // A concurrent request may already have refreshed the access token. Retry
      // with that token before rotating the refresh token again.
      const currentToken = getToken();
      if (
        currentToken &&
        config.headers.Authorization &&
        config.headers.Authorization !== 'Bearer ' + currentToken
      ) {
        config._isRefreshRetry = true;
        config.headers.Authorization = 'Bearer ' + currentToken;
        return api(config);
      }

      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          await attemptRefresh();
          if (getToken() && config._sessionId === (getSessionId() ?? null)) {
            config._isRefreshRetry = true;
            config.headers.Authorization = 'Bearer ' + getToken();
            return api(config);
          }
        } catch (refreshError) {
          if (refreshError.response?.status === 401) {
            if (
              getRefreshToken() &&
              getToken() &&
              config._sessionId === (getSessionId() ?? null)
            ) {
              config._isRefreshRetry = true;
              config.headers.Authorization = 'Bearer ' + getToken();
              return api(config);
            }

            if (!getRefreshToken()) window.location.reload();
          }

          throw error;
        }
      }
    }

    // A 401 on an authenticated route means this tab is showing signed-in UI
    // it has no session for, so send it back to the login screen. Note there
    // is deliberately no `getToken()` condition: when the token is already
    // gone (cleared in another tab, expired and dropped) there is nothing left
    // to clear, and requiring one left those tabs stuck — pollers like the
    // Overview's 1s transfers fetch just kept firing 401s forever with nothing
    // to break the cycle. Passthrough is exempt: there a 401 means the proxy
    // isn't injecting identity, and reloading would only loop.
    if (
      status === 401 &&
      !sessionAction &&
      !['/session', '/server', '/application'].includes(config?.url) &&
      !isPassthroughEnabled() &&
      (!getToken() || config.headers.Authorization === 'Bearer ' + getToken())
    ) {
      console.debug('received 401 from api route, logging out');
      clearToken();
      clearRefreshToken();
      clearSessionId();
      window.location.reload();
    }

    throw error;
  },
);

export default api;
