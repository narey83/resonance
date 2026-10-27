// <copyright file="libraryActivityHub.ts" company="John Narey">
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
} from '@microsoft/signalr';
import { useAppMode } from '../store/appModeStore';
import { createHubLogger, trackHubConnection } from '../lib/hubLifecycle';
import { useAuthStore } from '../store/auth';
import { createAccessTokenFactory } from './client';

export const LIBRARY_ACTIVITY_SNAPSHOT        = 'SNAPSHOT';
export const LIBRARY_ACTIVITY_LOVED           = 'TRACK_LOVED';
export const LIBRARY_ACTIVITY_UNLOVED         = 'TRACK_UNLOVED';
export const LIBRARY_ACTIVITY_ALL_UNLOVED     = 'ALL_UNLOVED';
export const LIBRARY_ACTIVITY_PLAYED          = 'TRACK_PLAYED';
export const LIBRARY_ACTIVITY_PLAY_DELETED    = 'PLAY_DELETED';
export const LIBRARY_ACTIVITY_HISTORY_CLEARED = 'HISTORY_CLEARED';
export const LIBRARY_ACTIVITY_LIBRARY_UPDATED = 'LIBRARY_UPDATED';
export const LIBRARY_ACTIVITY_SYNC_STATE      = 'SYNC_STATE';

export const createLibraryActivityHubConnection = () => {
  const { serverUrl } = useAuthStore.getState();
  if (useAppMode.getState().mode !== 'remote' || !serverUrl || !useAuthStore.getState().accessToken) return null;

  const logger = createHubLogger('library activity');
  return trackHubConnection(new HubConnectionBuilder()
    .withUrl(`${serverUrl}/hub/libraryactivity`, {
      accessTokenFactory: createAccessTokenFactory(),
    })
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (context) =>
        context.elapsedMilliseconds < 10_000
          ? Math.min(2 ** context.previousRetryCount * 500, 5_000)
          : 30_000,
    })
    .withServerTimeout(120_000)
    .withKeepAliveInterval(15_000)
    .withHubProtocol(new JsonHubProtocol())
    .configureLogging(logger)
    .build(), logger);
};
