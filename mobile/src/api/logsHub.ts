// <copyright file="logsHub.ts" company="John Narey">
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
  HubConnectionBuilder,
  JsonHubProtocol,
  LogLevel,
  RetryContext,
} from '@microsoft/signalr';
import { useAuthStore } from '../store/auth';
import { getValidToken } from './client';

const infiniteRetryPolicy = {
  nextRetryDelayInMilliseconds: (context: RetryContext) => {
    if (context.elapsedMilliseconds < 10_000) return Math.min(2 ** context.previousRetryCount * 500, 5_000);
    return 30_000;
  },
};

// Live server-log stream. On connect the hub replays its recent buffer via the
// BUFFER message, then pushes each new entry via LOG (method names are matched
// case-insensitively by the SignalR client).
export const createLogsHubConnection = () => {
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;

  return new HubConnectionBuilder()
    .withUrl(`${serverUrl}/hub/logs`, {
      accessTokenFactory: () => getValidToken(),
    })
    .withAutomaticReconnect(infiniteRetryPolicy)
    .withServerTimeout(120_000)
    .withKeepAliveInterval(15_000)
    .withHubProtocol(new JsonHubProtocol())
    .configureLogging(LogLevel.Information)
    .build();
};
