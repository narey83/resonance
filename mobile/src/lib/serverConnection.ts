// <copyright file="serverConnection.ts" company="John Narey">
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

import { stopHubConnection } from './hubLifecycle';
import { AppState } from 'react-native';
import { HubConnectionState, type HubConnection } from '@microsoft/signalr';

// SignalR retries established connections, but not a failed first start. Keep trying while
// this login is alive, and let each foreground transition reconcile missed server events.
export function maintainServerConnection(
  hub: HubConnection,
  current: () => boolean,
  onForeground: () => void,
  onError: (error: unknown) => void,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let starting: Promise<void> | undefined;
  const alive = () => !stopped && current();
  const retry = () => {
    if (!alive() || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void start();
    }, 5000);
  };
  const start = () => {
    if (!alive() || starting || hub.state !== HubConnectionState.Disconnected) return;
    starting = hub.start().then(() => {
      if (alive()) onForeground();
    }).catch((error: unknown) => {
      if (alive()) onError(error);
    }).finally(() => {
      starting = undefined;
      if (!alive()) void stopHubConnection(hub);
      else if (hub.state === HubConnectionState.Disconnected) retry();
    });
  };
  hub.onclose(retry);
  hub.onreconnected(() => { if (alive()) onForeground(); });
  start();
  const subscription = AppState.addEventListener('change', (state) => {
    if (!alive() || state !== 'active') return;
    onForeground();
    start();
  });
  return () => {
    stopped = true;
    subscription.remove();
    if (timer) clearTimeout(timer);
    void stopHubConnection(hub);
  };
}
