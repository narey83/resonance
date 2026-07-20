// <copyright file="hubFactory.js" company="JP Dillingham">
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

import { hubBaseUrl } from '../config';
import { attemptRefresh } from './api';
import {
  clearRefreshToken,
  clearSessionId,
  clearToken,
  getRefreshToken,
  getToken,
  isPassthroughEnabled,
} from './token';
import {
  HubConnectionBuilder,
  JsonHubProtocol,
  LogLevel,
} from '@microsoft/signalr';

const getValidToken = async () => {
  const token = getToken();
  if (!token) return token;

  let payload = null;
  try {
    payload = JSON.parse(atob(token.split('.')[1]));
  } catch {
    /* ignore */
  }

  if (payload) {
    const isStaleOrSoon = payload.exp * 1_000 < Date.now() + 60_000;
    if (isStaleOrSoon && getRefreshToken()) {
      try {
        await attemptRefresh();
      } catch (error) {
        if (error.response?.status === 401) {
          clearToken();
          clearRefreshToken();
          clearSessionId();
          window.location.reload(true);
          return null;
        }
      }
    }
  }

  return getToken();
};

const createInfiniteRetryPolicy = (onRetry) => ({
  nextRetryDelayInMilliseconds: (context) => {
    onRetry?.(context);
    if (context.elapsedMilliseconds < 10_000)
      return Math.min(2 ** context.previousRetryCount * 500, 5_000);
    return 10_000;
  },
});

export const createHubConnection = ({ onRetry, url }) => {
  const connection = new HubConnectionBuilder()
    .withUrl(url, {
      accessTokenFactory: isPassthroughEnabled() ? undefined : getValidToken,
      withCredentials: true,
    })
    .withAutomaticReconnect(createInfiniteRetryPolicy(onRetry))
    .withHubProtocol(new JsonHubProtocol())
    .configureLogging(LogLevel.Error)
    .build();
  connection.serverTimeoutInMilliseconds = 120_000;
  return connection;
};

export const createApplicationHubConnection = ({ onRetry } = {}) =>
  createHubConnection({ onRetry, url: `${hubBaseUrl}/application` });

export const createLogsHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/logs` });

export const createSearchHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/search` });

export const createMixtapesHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/mixtapes` });

export const createLibraryActivityHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/libraryactivity` });

export const createYtDlpHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/ytdlp` });

export const createBrowseHubConnection = () =>
  createHubConnection({ url: `${hubBaseUrl}/browse` });
