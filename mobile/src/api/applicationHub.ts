// <copyright file="applicationHub.ts" company="John Narey">
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
  RetryContext,
} from '@microsoft/signalr';
import { useAppMode } from '../store/appModeStore';
import { createHubLogger, trackHubConnection } from '../lib/hubLifecycle';
import { useAuthStore } from '../store/auth';
import { createAccessTokenFactory } from './client';

const infiniteRetryPolicy = {
  nextRetryDelayInMilliseconds: (context: RetryContext) => {
    if (context.elapsedMilliseconds < 10_000) return Math.min(2 ** context.previousRetryCount * 500, 5_000);
    return 30_000;
  },
};

export const createApplicationHubConnection = () => {
  const { serverUrl } = useAuthStore.getState();
  if (useAppMode.getState().mode !== 'remote' || !serverUrl || !useAuthStore.getState().accessToken) return null;

  const logger = createHubLogger('application');
  return trackHubConnection(new HubConnectionBuilder()
    .withUrl(`${serverUrl}/hub/application`, {
      accessTokenFactory: createAccessTokenFactory(),
    })
    .withAutomaticReconnect(infiniteRetryPolicy)
    .withServerTimeout(120_000)
    .withKeepAliveInterval(15_000)
    .withHubProtocol(new JsonHubProtocol())
    .configureLogging(logger)
    .build(), logger);
};
