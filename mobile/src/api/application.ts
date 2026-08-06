// <copyright file="application.ts" company="John Narey">
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

import { apiClient } from './client';

export interface AppState {
  version: {
    full:              string;
    current:           string;
    latest:            string | null;
    isUpdateAvailable: boolean;
    isCanary:          boolean;
    isDevelopment:     boolean;
  };
  server: {
    address:         string;
    ipEndPoint?:     string | null;
    state:           string;
    isConnected:     boolean;
    isConnecting:    boolean;
    isLoggedIn:      boolean;
    isTransitioning: boolean;
  };
  connectionWatchdog?: {
    isEnabled:              boolean;
    isAttemptingConnection: boolean;
    isAwaitingVpn:          boolean;
    nextAttemptAt?:         string | null;
  };
  upnp?: {
    isEnabled:          boolean;
    isMapped:           boolean;
    externalIPAddress?: string | null;
    mappedPort?:        number | null;
  };
  distributedNetwork?: {
    branchLevel:       number;
    branchRoot?:       string | null;
    canAcceptChildren: boolean;
    childLimit:        number;
    hasParent:         boolean;
    isBranchRoot:      boolean;
    parent?:           string | null;
    parentIPEndPoint?: string | null;
    children:          { username: string; ipEndPoint?: string | null }[];
  };
  health?: {
    search: { incoming: { latency: number; queueDepth: number; dropRate: number } };
  };
  user: {
    username:   string;
    presence?:  string;
    privileges: { isPrivileged: boolean; privilegesRemaining: number };
    statistics: { averageSpeed: number; directoryCount: number; fileCount: number; uploadCount: number };
  };
  shares: {
    ready:       boolean;
    scanning:    boolean;
    scanPending: boolean;
    faulted:     boolean;
    directories: number;
    files:       number;
  };
  // Free space on the volume holding the *downloads* directory — not the
  // container/host root (see Application.GetDiskState on the backend).
  disk?: {
    availableBytes:   number;
    totalBytes:       number;
    downloadsBlocked: boolean;
  };
}

export const getApplicationState = () =>
  apiClient.get<AppState>('/application').then(r => r.data);
